import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { AsnResponse, CountryResponse, Reader } from 'mmdb-lib';

/**
 * IP -> country / ASN with the DB-IP Lite databases (CC BY 4.0, "IP Geolocation by DB-IP", https://db-ip.com).
 * Files: $GEOIP_DIR/dbip-country.mmdb and dbip-asn.mmdb (updated monthly on the host, reloaded here when changed).
 * Without the files every lookup returns null (development / tests).
 */
export type GeoInfo = {
  country?: string;        // ISO code, e.g. "KR"
  countryName?: string;    // English name from the DB
  asn?: number;
  org?: string;            // network owner, e.g. "Korea Telecom", "Amazon.com, Inc."
  hosting?: boolean;       // data center / cloud / VPN provider network (VPN or proxy likely)
  private?: boolean;       // LAN / loopback address
};

type CountryRec = CountryResponse;
type AsnRec = AsnResponse;

let readers: { country: Reader<CountryRec> | null; asn: Reader<AsnRec> | null; stamp: string; checkedAt: number } =
  { country: null, asn: null, stamp: '', checkedAt: 0 };

function files() {
  const dir = process.env.GEOIP_DIR ?? '/geoip';
  return { country: join(dir, 'dbip-country.mmdb'), asn: join(dir, 'dbip-asn.mmdb') };
}

function load() {
  const now = Date.now();
  if (now - readers.checkedAt < 10 * 60_000 && readers.checkedAt) return;
  readers.checkedAt = now;
  const f = files();
  try {
    const stamp = `${statSync(f.country).mtimeMs}:${statSync(f.asn).mtimeMs}`;
    if (stamp === readers.stamp) return;
    readers = { country: new Reader<CountryRec>(readFileSync(f.country)), asn: new Reader<AsnRec>(readFileSync(f.asn)), stamp, checkedAt: now };
  } catch {
    // files missing: keep whatever was loaded before (or nothing)
  }
}

/** Private / loopback / link-local addresses (v4 and v6, incl. ::ffff:a.b.c.d). */
export function isPrivateIp(ip: string) {
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/** Network owners that are data centers, clouds or VPN/proxy providers (not home or mobile lines). */
const HOSTING = /amazon|aws|google cloud|google llc|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|choopa|m247|datacamp|leaseweb|oracle|alibaba|tencent|cloudflare|contabo|scaleway|hostinger|hostwinds|psychz|quadranet|colocrossing|ionos|zenlayer|g-core|gcore|cdn77|packethub|tzulo|nordvpn|expressvpn|private internet access|mullvad|proton|surfshark|ipvanish|windscribe|hide\.me|cyberghost|data ?center|datacenter|hosting|server|cloud|vps|colo/i;

export function geoLookup(ipRaw?: string | null): GeoInfo | null {
  if (!ipRaw) return null;
  const ip = ipRaw.replace(/^::ffff:/i, '').trim();
  if (isPrivateIp(ip)) return { private: true };
  load();
  if (!readers.country && !readers.asn) return null;
  try {
    const c = readers.country?.get(ip) ?? null;
    const a = readers.asn?.get(ip) ?? null;
    const org = a?.autonomous_system_organization;
    return {
      country: c?.country?.iso_code, countryName: (c?.country?.names as Record<string, string> | undefined)?.en,
      asn: a?.autonomous_system_number, org,
      hosting: org ? HOSTING.test(org) : undefined,
    };
  } catch {
    return null;
  }
}
