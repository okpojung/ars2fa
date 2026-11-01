import type { Request } from 'express';
import { getClientIp } from '../../common/request.util';

export type ClientInfo = {
  ip?: string | null;
  ua?: string;
  browser?: string;
  os?: string;
  device?: string;      // e.g. "Samsung SM-S918N", "iPhone", "Windows PC"
  deviceType?: 'mobile' | 'tablet' | 'desktop';
  lang?: string;
  at?: string;
  // reported by the page itself (best effort)
  screen?: string;
  tz?: string;
  model?: string;       // Chrome UA-CH model (Android), e.g. "SM-S918N"
  platformVersion?: string;
};

const SAMSUNG = /^(SM-|SHV-|SHW-|SCH-|SGH-)/i;
const LG = /^(LM-|LG-)/i;

/** Small User-Agent reader for the browsers/phones we see in Korea (no external dependency). */
export function parseUserAgent(ua?: string | null): Pick<ClientInfo, 'browser' | 'os' | 'device' | 'deviceType'> {
  const s = ua ?? '';
  if (!s) return {};
  let browser = 'Unknown';
  const m = (re: RegExp) => s.match(re);
  let r: RegExpMatchArray | null;
  if ((r = m(/KAKAOTALK\s?([\d.]+)?/i))) browser = `카카오톡 인앱${r[1] ? ' ' + r[1] : ''}`;
  else if ((r = m(/NAVER\(inapp;[^)]*?([\d.]+)\)/i)) || m(/NAVER\(inapp/i)) browser = '네이버 앱';
  else if ((r = m(/Whale\/([\d.]+)/))) browser = `Whale ${r[1].split('.')[0]}`;
  else if ((r = m(/SamsungBrowser\/([\d.]+)/))) browser = `삼성 인터넷 ${r[1].split('.')[0]}`;
  else if ((r = m(/Edg(?:A|iOS)?\/([\d.]+)/))) browser = `Edge ${r[1].split('.')[0]}`;
  else if ((r = m(/OPR\/([\d.]+)/))) browser = `Opera ${r[1].split('.')[0]}`;
  else if ((r = m(/Firefox\/([\d.]+)|FxiOS\/([\d.]+)/))) browser = `Firefox ${(r[1] ?? r[2]).split('.')[0]}`;
  else if ((r = m(/CriOS\/([\d.]+)/))) browser = `Chrome ${r[1].split('.')[0]} (iOS)`;
  else if ((r = m(/Chrome\/([\d.]+)/))) browser = `${/; wv\)/.test(s) ? 'Android WebView' : 'Chrome'} ${r[1].split('.')[0]}`;
  else if ((r = m(/Version\/([\d.]+).*Safari/))) browser = `Safari ${r[1].split('.')[0]}`;
  else if (/okhttp|Dart\/|CFNetwork/i.test(s)) browser = s.split(' ')[0];

  let os = 'Unknown';
  let device: string | undefined;
  let deviceType: ClientInfo['deviceType'] = 'desktop';
  if ((r = m(/Android\s([\d.]+)(?:;\s*([^;)]+))?(?:;\s*([^;)]+))?/))) {
    os = `Android ${r[1]}`;
    deviceType = /Mobile/.test(s) ? 'mobile' : 'tablet';
    const parts = [r[2], r[3]].map((x) => (x ?? '').replace(/\s*Build\/.*$/, '').trim()).filter((x) => x && !/^(K|wv|Linux|U|ko[-_]KR)$/i.test(x));
    const model = (parts.find((x) => x !== 'K') ?? '').replace(/\sBuild\/.*/, '');
    if (model) device = SAMSUNG.test(model) ? `Samsung ${model}` : LG.test(model) ? `LG ${model}` : model;
    else device = 'Android';
  } else if ((r = m(/iPhone OS ([\d_]+)/))) { os = `iOS ${r[1].replace(/_/g, '.')}`; device = 'iPhone'; deviceType = 'mobile'; }
  else if ((r = m(/iPad.*OS ([\d_]+)/))) { os = `iPadOS ${r[1].replace(/_/g, '.')}`; device = 'iPad'; deviceType = 'tablet'; }
  else if ((r = m(/Windows NT ([\d.]+)/))) { os = r[1] === '10.0' ? 'Windows 10/11' : `Windows NT ${r[1]}`; device = 'Windows PC'; }
  else if ((r = m(/Mac OS X ([\d_]+)/))) { os = `macOS ${r[1].replace(/_/g, '.')}`; device = 'Mac'; }
  else if (/CrOS/.test(s)) { os = 'ChromeOS'; device = 'Chromebook'; }
  else if (/Linux/.test(s)) { os = 'Linux'; device = 'Linux PC'; }
  return { browser, os, device, deviceType };
}

/** IP, User-Agent (parsed) and language of a request. */
export function describeRequest(req: Request): ClientInfo {
  const ua = (req.header('user-agent') ?? '').slice(0, 400);
  const lang = (req.header('accept-language') ?? '').split(',')[0]?.slice(0, 20) || undefined;
  return { ip: getClientIp(req) ?? null, ua, ...parseUserAgent(ua), lang, at: new Date().toISOString() };
}

/** Extra fields a page may report about itself (strings only, short). */
export function cleanReportedInfo(raw: unknown): Partial<ClientInfo> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined);
  return { screen: str(o.screen, 20), tz: str(o.tz, 40), model: str(o.model, 60), platformVersion: str(o.platformVersion, 20), lang: str(o.lang, 20) };
}
