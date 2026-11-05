import { geoLookup, isPrivateIp } from '../src/modules/ars-engine/geoip';
import { geoRisk } from '../src/modules/ars-engine/client-info.util';

describe('IP location (record only)', () => {
  test('private addresses are marked, unknown without databases', () => {
    expect(isPrivateIp('192.168.100.5')).toBe(true);
    expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIp('121.134.237.38')).toBe(false);
    expect(geoLookup('192.168.0.1')).toEqual({ private: true });
    process.env.GEOIP_DIR = '/nonexistent';
    expect(geoLookup('8.8.8.8')).toBeNull();
  });

  test('risk: country mismatch and VPN/data center networks', () => {
    const kr = { geo: { country: 'KR', org: 'SK Broadband', hosting: false } };
    const us = { geo: { country: 'US', org: 'DigitalOcean, LLC', hosting: true } };
    expect(geoRisk(kr, kr)).toEqual({ pc_country: 'KR', phone_country: 'KR', country_mismatch: false, vpn_suspect: false });
    expect(geoRisk(us, kr)).toEqual({ pc_country: 'US', phone_country: 'KR', country_mismatch: true, vpn_suspect: true });
    expect(geoRisk(kr, null)).toMatchObject({ country_mismatch: null });
  });
});
