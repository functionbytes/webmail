import { createConnection, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS (port 465); false = plain + STARTTLS (port 587) */
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function authPlain(user: string, pass: string): string {
  // AUTH PLAIN encodes \0user\0pass in base64
  return Buffer.from(`\0${user}\0${pass}`, 'utf-8').toString('base64');
}

function escapeMime(str: string): string {
  return str.replace(/[\r\n]/g, ' ');
}

/**
 * Minimal SMTP client supporting STARTTLS + AUTH PLAIN.
 * Zero external dependencies — uses Node.js `net` and `tls` only.
 */
export async function sendPasswordResetEmail(opts: {
  smtp: SmtpConfig;
  toEmail: string;
  username: string;
  resetLink: string;
  appName: string;
}): Promise<void> {
  const { smtp, toEmail, username, resetLink, appName } = opts;

  return new Promise((resolve, reject) => {
    let socket: Socket | TLSSocket;
    let buffer = '';
    const pending: string[] = [];
    let lineWaiter: ((line: string) => void) | null = null;

    function onData(chunk: Buffer | string): void {
      buffer += chunk.toString();
      const parts = buffer.split('\r\n');
      buffer = parts.pop() ?? '';
      for (const p of parts) {
        if (p) pending.push(p);
      }
      if (lineWaiter && pending.length > 0) {
        const waiter = lineWaiter;
        lineWaiter = null;
        waiter(pending.shift()!);
      }
    }

    function nextLine(): Promise<string> {
      return new Promise((res) => {
        if (pending.length > 0) {
          res(pending.shift()!);
        } else {
          lineWaiter = res;
        }
      });
    }

    /** Read a full SMTP response; handles multi-line 250-... / 250 ... */
    async function readResponse(expectedCode: string): Promise<string> {
      let full = '';
      while (true) {
        const line = await nextLine();
        full += (full ? '\n' : '') + line;
        if (line.startsWith(`${expectedCode} `)) break;
        if (!line.startsWith(`${expectedCode}-`)) {
          throw new Error(`SMTP error (expected ${expectedCode}): ${line}`);
        }
      }
      return full;
    }

    function send(cmd: string): void {
      (socket as Socket).write(`${cmd}\r\n`);
    }

    async function run(): Promise<void> {
      await readResponse('220'); // server greeting

      send('EHLO bulwark');
      const ehloResp = await readResponse('250');

      if (!smtp.secure && ehloResp.includes('STARTTLS')) {
        send('STARTTLS');
        await readResponse('220');
        const plain = socket as Socket;
        socket = tlsConnect({ socket: plain, host: smtp.host, rejectUnauthorized: true });
        socket.on('data', onData);
        await new Promise<void>((res, rej) => {
          (socket as TLSSocket).once('secureConnect', res);
          (socket as TLSSocket).once('error', rej);
        });
        send('EHLO bulwark');
        await readResponse('250');
      }

      send(`AUTH PLAIN ${authPlain(smtp.user, smtp.pass)}`);
      await readResponse('235');

      send(`MAIL FROM:<${smtp.from}>`);
      await readResponse('250');

      send(`RCPT TO:<${toEmail}>`);
      await readResponse('250');

      send('DATA');
      await readResponse('354');

      const body = [
        `From: ${escapeMime(appName)} <${smtp.from}>`,
        `To: <${toEmail}>`,
        `Subject: Reset your ${escapeMime(appName)} password`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        `Hi ${username},`,
        ``,
        `Someone requested a password reset for your ${appName} account.`,
        ``,
        `Reset link (valid for 1 hour):`,
        resetLink,
        ``,
        `If you did not request this, you can safely ignore this email.`,
        ``,
        `\u2013 The ${appName} team`,
        `.`,
      ].join('\r\n');

      send(body);
      await readResponse('250');

      send('QUIT');
      socket.destroy();
      resolve();
    }

    if (smtp.secure) {
      socket = tlsConnect({ host: smtp.host, port: smtp.port, rejectUnauthorized: true });
      (socket as TLSSocket).once('secureConnect', () => run().catch(reject));
    } else {
      socket = createConnection({ host: smtp.host, port: smtp.port });
      socket.once('connect', () => run().catch(reject));
    }

    socket.on('data', onData);
    socket.once('error', reject);
  });
}
