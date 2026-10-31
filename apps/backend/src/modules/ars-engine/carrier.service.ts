import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type CarrierRequest = { vn: string; rn: string; link: boolean };
export type CarrierReply = { resCd: string; resMsg: string };
export type CarrierClient = (req: CarrierRequest) => Promise<CarrierReply>;
export type CarrierResult = { ok: boolean; code: string; message: string; ms: number };

/**
 * CallMix vnMapping: switches forwarding of one 0507 to its 070 on (linkYn=y) or off (linkYn=n).
 * Coloring and call comment are always sent as 0 ("선택 안함") so callers hear nothing from CallMix.
 * rn is always sent because the API treats it as required, also for linkYn=n.
 * Credentials come from CALLMIX_ID / CALLMIX_PW (server env only). Without them the client is disabled and
 * only STATIC numbers can be leased.
 *
 * "Off" mode: with CALLMIX_GUARD_RN set, a resting number is not left unforwarded (callers would only hear
 * ringing) but forwarded to that guard 070, where no authentication ever waits, so the PBX answers with the
 * "not a valid access" message and hangs up. Without it, off means linkYn=n.
 */
@Injectable()
export class CarrierService {
  private readonly log = new Logger('CallMix');
  client: CarrierClient | null = CarrierService.fromEnv();

  constructor(private readonly prisma: PrismaService) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): CarrierClient | null {
    const id = env.CALLMIX_ID;
    const pw = env.CALLMIX_PW;
    if (!id || !pw) return null;
    const base = (env.CALLMIX_API_BASE ?? 'https://m.callmix.co.kr/cmxapi').replace(/\/+$/, '');
    const shopName = env.CALLMIX_SHOP_NAME ?? 'ARS인증';
    const timeout = Number(env.CALLMIX_TIMEOUT_MS ?? 5000);
    const guard = (env.CALLMIX_GUARD_RN ?? '').replace(/\D/g, '');
    return async ({ vn, rn, link }) => {
      const target = link ? rn : guard || rn;
      const linkYn = link || guard ? 'y' : 'n';
      const body = new URLSearchParams({ id, pw, vn, rn: target, linkYn, shopName, colorRing: '0', callMent: '0' });
      const r = await fetch(`${base}/vnMapping`, {
        method: 'POST', body, signal: AbortSignal.timeout(timeout),
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      });
      const text = await r.text();
      if (!r.ok) return { resCd: `HTTP_${r.status}`, resMsg: text.slice(0, 200) };
      try {
        const j = JSON.parse(text) as { resCd?: unknown; resMsg?: unknown };
        return { resCd: String(j.resCd ?? ''), resMsg: String(j.resMsg ?? '') };
      } catch {
        return { resCd: 'BAD_RESPONSE', resMsg: text.slice(0, 200) };
      }
    };
  }

  get enabled() {
    return this.client !== null;
  }

  async set(vnId: number, vn: string, rn: string, link: boolean): Promise<CarrierResult> {
    const started = Date.now();
    let code = 'DISABLED';
    let message = 'CallMix credentials are not configured';
    if (this.client) {
      try {
        const r = await this.client({ vn, rn, link });
        code = r.resCd || 'EMPTY';
        message = r.resMsg;
      } catch (e) {
        code = (e as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'ERROR';
        message = (e as Error).message;
      }
    }
    const res: CarrierResult = { ok: code === 'SUCCESS', code: code.slice(0, 40), message: (message ?? '').slice(0, 200), ms: Date.now() - started };
    await this.prisma.carrierCall
      .create({ data: { vnId, vn, action: link ? 'LINK' : 'UNLINK', ok: res.ok, resCd: res.code, resMsg: res.message, ms: res.ms } })
      .catch(() => undefined);
    if (!res.ok) this.log.warn(`${link ? 'link' : 'unlink'} ${vn} failed: ${res.code} ${res.message}`);
    return res;
  }
}
