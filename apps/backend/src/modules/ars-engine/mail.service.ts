import { Injectable, Logger } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as nodemailer from 'nodemailer';

export type EmailCheck = { ok: boolean; reason?: 'format' | 'domain' | 'no_mail_server'; domain?: string };

/** Email address checks (format + the domain receives mail) and outgoing mail through SMTP (SMTP_* in .env). */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private transport: nodemailer.Transporter | null = null;
  private cache = new Map<string, { at: number; r: EmailCheck }>();

  get enabled() {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  /** Practical address syntax (not the full RFC): local@domain.tld, no spaces, sane lengths. */
  static formatOk(email: string) {
    if (email.length > 254) return false;
    const m = /^([A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64})@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/.exec(email);
    if (!m) return false;
    const local = m[1];
    return !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && /\.[A-Za-z]{2,}$/.test(m[2]);
  }

  /** Format, then DNS: the domain must have MX records (or at least an address record, the SMTP fallback). */
  async check(raw: string): Promise<EmailCheck> {
    const email = (raw ?? '').trim();
    if (!MailService.formatOk(email)) return { ok: false, reason: 'format' };
    const domain = email.split('@')[1].toLowerCase();
    const hit = this.cache.get(domain);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.r;
    let r: EmailCheck;
    try {
      const mx = await withTimeout(dns.resolveMx(domain), 4000).catch(() => []);
      if (mx.length && mx.some((x) => x.exchange && x.exchange !== '.')) r = { ok: true, domain };
      else if (mx.length) r = { ok: false, reason: 'no_mail_server', domain }; // "null MX": the domain says it takes no mail
      else {
        const a = await withTimeout(dns.resolve4(domain), 4000).catch(() => []);
        const aaaa = a.length ? [] : await withTimeout(dns.resolve6(domain), 4000).catch(() => []);
        r = a.length || aaaa.length ? { ok: true, domain } : { ok: false, reason: 'domain', domain };
      }
    } catch {
      r = { ok: false, reason: 'domain', domain };
    }
    this.cache.set(domain, { at: Date.now(), r });
    if (this.cache.size > 2000) this.cache.clear();
    return r;
  }

  async send(msg: { to: string | string[]; subject: string; text: string; replyTo?: string }) {
    if (!this.enabled) return false;
    if (!this.transport) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port, secure: port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
    await this.transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: msg.to, subject: msg.subject, text: msg.text, replyTo: msg.replyTo });
    this.log.log(`mail sent (${Array.isArray(msg.to) ? msg.to.length : 1} recipient(s))`);
    return true;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
