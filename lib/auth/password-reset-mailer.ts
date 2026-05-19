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
}

/** Encode a string for use in an SMTP AUTH PLAIN payload. */
function authPlainPayload(user: string, pass: string): string {
  // \0user\0pass
  return Buffer.from(`\0${user}\0${pass}`).toString('base64');
}

/** Minimal zero-dependency SMTP send (STARTTLS + AUTH PLAIN). */
export async function sendPasswordResetEmail(
  opts: ResetEmailOptions,
): Promise<void> {
  const { smtp, toEmail, username, resetLink, appName } = opts;

  const subject = `[${appName}] Password Reset Request`;
  const text = [
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
  const rawMessage = [
    `Date: ${date}`,
    `Message-ID: ${msgId}`,
    `From: ${smtp.from}`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
  ].join('\r\n');

  await smtpSend(smtp, smtp.from, [toEmail], rawMessage);
  logger.info('Password reset email sent', { to: toEmail, username });
}

// ─── Minimal SMTP implementation ─────────────────────────────────────────────

type SocketLike = net.Socket | tls.TLSSocket;

function readLines(sock: SocketLike): AsyncIterable<string> {
  let buf = '';
  const lines: string[] = [];
  let resolve: ((v: string) => void) | null = null;

  sock.on('data', (chunk: Buffer) => {
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
  });

  return {
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
        const lines = readLines(plain);
        // greeting
        await readReply(lines);
        // EHLO
        await cmd(plain, lines, `EHLO ${cfg.host}`, 250);

        let sock: SocketLike = plain;

        if (!cfg.secure) {
          // STARTTLS upgrade
          await cmd(plain, lines, 'STARTTLS', 220);
          sock = await new Promise<tls.TLSSocket>((res, rej) => {
            const tlsSock = tls.connect(
              { socket: plain, servername: cfg.host, rejectUnauthorized: true },
              () => res(tlsSock),
            );
            tlsSock.once('error', rej);
          });
          const tlsLines = readLines(sock);
          await cmd(sock, tlsLines, `EHLO ${cfg.host}`, 250);
          // AUTH PLAIN
          await cmd(
            sock,
            tlsLines,
            `AUTH PLAIN ${authPlainPayload(cfg.user, cfg.pass)}`,
            235,
          );
          // MAIL / RCPT / DATA
          await cmd(sock, tlsLines, `MAIL FROM:<${from}>`, 250);
          for (const addr of to) {
            await cmd(sock, tlsLines, `RCPT TO:<${addr}>`, 250);
          }
          await cmd(sock, tlsLines, 'DATA', 354);
          await new Promise<void>((res, rej) =>
            sock.write(`${raw}\r\n.\r\n`, (e) => (e ? rej(e) : res())),
          );
          const dataReply = await readReply(tlsLines);
          if (dataReply.code !== 250) {
            throw new Error(`SMTP DATA failed: ${dataReply.code} ${dataReply.text}`);
          }
          await cmd(sock, tlsLines, 'QUIT', 221);
        } else {
          // Implicit TLS — wrap right away
          const tlsSock = tls.connect(
            { socket: plain, servername: cfg.host, rejectUnauthorized: true },
            async () => {
              try {
                const tlsLines = readLines(tlsSock);
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
            },
          );
          tlsSock.once('error', reject);
          return;
        }

        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
}
