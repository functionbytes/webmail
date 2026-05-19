import * as net from 'node:net';
import * as tls from 'node:tls';
import { logger } from '@/lib/logger';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean; // true = implicit TLS on connect, false = STARTTLS
  user: string;
  pass: string;
  from: string;
}

export interface ResetEmailOptions {
  smtp: SmtpConfig;
  toEmail: string;
  username: string;
  resetLink: string;
  appName: string;
  /** When true, the email is phrased as an invitation to set an initial password. */
  isInvite?: boolean;
}

// ─── Input validation ─────────────────────────────────────────────────────────

/**
 * Reject strings containing CR, LF, or NUL — prevents header/command injection.
 * Also rejects angle brackets to prevent SMTP command boundary escapes.
 */
function assertSafeHeader(value: string, field: string): void {
  if (/[\r\n\0<>]/.test(value)) {
    throw new Error(`Invalid characters in ${field}`);
  }
}

/**
 * Minimal RFC5322 email validation: no whitespace, exactly one @, valid-looking
 * local + domain parts. Rejects CR/LF/NUL implicitly via assertSafeHeader.
 */
function assertValidEmail(value: string, field: string): void {
  assertSafeHeader(value, field);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`Invalid email address in ${field}: ${value}`);
  }
}

/** Encode a string for use in an SMTP AUTH PLAIN payload. */
function authPlainPayload(user: string, pass: string): string {
  // \0user\0pass
  return Buffer.from(`\0${user}\0${pass}`).toString('base64');
}

/** Minimal zero-dependency SMTP send (STARTTLS or implicit TLS + AUTH PLAIN). */
export async function sendPasswordResetEmail(
  opts: ResetEmailOptions,
): Promise<void> {
  const { smtp, toEmail, username, resetLink, appName, isInvite } = opts;

  // Validate all header / command values before any network activity
  assertValidEmail(toEmail, 'toEmail');
  assertValidEmail(smtp.from, 'smtp.from');
  assertSafeHeader(appName, 'appName');
  assertSafeHeader(username, 'username');

  const subject = isInvite
    ? `[${appName}] You have been invited`
    : `[${appName}] Password Reset Request`;

  const text = isInvite
    ? [
        `Hi ${username},`,
        '',
        `You have been invited to ${appName}.`,
        'Click the link below within 1 hour to set your password and activate your account:',
        '',
        resetLink,
        '',
        'If you did not expect this invitation, you can safely ignore this email.',
        '',
        `— ${appName}`,
      ].join('\r\n')
    : [
        `Hi ${username},`,
        '',
        'You (or someone else) requested a password reset for your account.',
        'Click the link below within 1 hour to set a new password:',
        '',
        resetLink,
        '',
        'If you did not request this, you can safely ignore this email.',
        '',
        `— ${appName}`,
      ].join('\r\n');

  const date = new Date().toUTCString();
  const msgId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${smtp.host}>`;

  // RFC 5321 §4.5.2: lines beginning with '.' must be dot-stuffed
  const stuffedText = text
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');

  const rawMessage = [
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    `From: ${smtp.from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    stuffedText,
  ].join('\r\n');

  await smtpSend(smtp, smtp.from, [toEmail], rawMessage);
  logger.info(isInvite ? 'Invite email sent' : 'Password reset email sent', { to: toEmail, username });
}

// ─── Minimal SMTP implementation ─────────────────────────────────────────────

type SocketLike = net.Socket | tls.TLSSocket;

function readLines(sock: SocketLike): { iterable: AsyncIterable<string>; detach: () => void } {
  let buf = '';
  const lines: string[] = [];
  let resolve: ((v: string) => void) | null = null;

  const onData = (chunk: Buffer) => {
    buf += chunk.toString();
    const parts = buf.split('\r\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      if (resolve) {
        const r = resolve;
        resolve = null;
        r(line);
      } else {
        lines.push(line);
      }
    }
  };

  sock.on('data', onData);

  const detach = () => sock.off('data', onData);

  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<string>> =>
        new Promise((res) => {
          const line = lines.shift();
          if (line !== undefined) {
            res({ value: line, done: false });
          } else {
            resolve = (v) => res({ value: v, done: false });
          }
        }),
    }),
  };

  return { iterable, detach };
}

async function readReply(
  lines: AsyncIterable<string>,
): Promise<{ code: number; text: string }> {
  let lastCode = 0;
  let text = '';
  for await (const line of lines) {
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!m) continue;
    lastCode = parseInt(m[1], 10);
    text = m[3];
    if (m[2] === ' ') break; // last line of multi-line reply
  }
  return { code: lastCode, text };
}

async function cmd(
  sock: SocketLike,
  lines: AsyncIterable<string>,
  command: string,
  expectCode: number,
): Promise<void> {
  await new Promise<void>((res, rej) =>
    sock.write(command + '\r\n', (e) => (e ? rej(e) : res())),
  );
  const reply = await readReply(lines);
  if (reply.code !== expectCode) {
    throw new Error(`SMTP ${command.split(' ')[0]} failed: ${reply.code} ${reply.text}`);
  }
}

async function smtpSend(
  cfg: SmtpConfig,
  from: string,
  to: string[],
  raw: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const plain = net.createConnection(cfg.port, cfg.host);
    plain.once('error', reject);

    plain.once('connect', async () => {
      try {
        const { iterable: lines, detach: detachPlain } = readLines(plain);

        // greeting
        await readReply(lines);
        // EHLO
        await cmd(plain, lines, `EHLO ${cfg.host}`, 250);

        if (!cfg.secure) {
          // STARTTLS upgrade — detach the plaintext reader first so encrypted
          // TLS records don't corrupt the plain-text buffer
          await cmd(plain, lines, 'STARTTLS', 220);
          detachPlain();

          const tlsSock = await new Promise<tls.TLSSocket>((res, rej) => {
            const s = tls.connect(
              { socket: plain, servername: cfg.host, rejectUnauthorized: true },
              () => res(s),
            );
            s.once('error', rej);
          });

          const { iterable: tlsLines } = readLines(tlsSock);
          await cmd(tlsSock, tlsLines, `EHLO ${cfg.host}`, 250);
          await cmd(
            tlsSock,
            tlsLines,
            `AUTH PLAIN ${authPlainPayload(cfg.user, cfg.pass)}`,
            235,
          );
          await cmd(tlsSock, tlsLines, `MAIL FROM:<${from}>`, 250);
          for (const addr of to) {
            await cmd(tlsSock, tlsLines, `RCPT TO:<${addr}>`, 250);
          }
          await cmd(tlsSock, tlsLines, 'DATA', 354);
          await new Promise<void>((res, rej) =>
            tlsSock.write(`${raw}\r\n.\r\n`, (e) => (e ? rej(e) : res())),
          );
          const dataReply = await readReply(tlsLines);
          if (dataReply.code !== 250) {
            throw new Error(`SMTP DATA failed: ${dataReply.code} ${dataReply.text}`);
          }
          await cmd(tlsSock, tlsLines, 'QUIT', 221);
          resolve();
        } else {
          // Implicit TLS — detach the plain reader, wrap socket immediately
          detachPlain();

          const tlsSock = await new Promise<tls.TLSSocket>((res, rej) => {
            const s = tls.connect(
              { socket: plain, servername: cfg.host, rejectUnauthorized: true },
              () => res(s),
            );
            s.once('error', rej);
          });

          try {
            const { iterable: tlsLines } = readLines(tlsSock);
            await readReply(tlsLines); // greeting
            await cmd(tlsSock, tlsLines, `EHLO ${cfg.host}`, 250);
            await cmd(
              tlsSock,
              tlsLines,
              `AUTH PLAIN ${authPlainPayload(cfg.user, cfg.pass)}`,
              235,
            );
            await cmd(tlsSock, tlsLines, `MAIL FROM:<${from}>`, 250);
            for (const addr of to) {
              await cmd(tlsSock, tlsLines, `RCPT TO:<${addr}>`, 250);
            }
            await cmd(tlsSock, tlsLines, 'DATA', 354);
            await new Promise<void>((res, rej) =>
              tlsSock.write(`${raw}\r\n.\r\n`, (e) => (e ? rej(e) : res())),
            );
            const dataReply = await readReply(tlsLines);
            if (dataReply.code !== 250) {
              throw new Error(`SMTP DATA failed: ${dataReply.code} ${dataReply.text}`);
            }
            await cmd(tlsSock, tlsLines, 'QUIT', 221);
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}
