import { generateKeyPairSync, createHash, sign as cryptoSign } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { ApiKeyAuthService } from '../src/modules/ars-engine/api-key-auth.service';
import { ArsSessionService, parseKstDateTime } from '../src/modules/ars-engine/ars-session.service';
import { ArsSettingsService } from '../src/modules/ars-engine/ars-settings.service';
import { IntegrityService } from '../src/modules/ars-engine/integrity/integrity.service';
import { NumberPoolService, secureShuffle, sequentialRn } from '../src/modules/ars-engine/number-pool.service';
import { PlayIntegrityVerifier } from '../src/modules/ars-engine/integrity/play-integrity';
import { decodeCbor } from '../src/modules/ars-engine/integrity/cbor';
import { isHiddenCaller, normalizeKrPhone, openText, sealText } from '../src/modules/ars-engine/phone.util';
import { kst, LINES, numbers, resetDb, seedClient } from './helpers';

const prisma = new PrismaService();
const redis = new RedisService();
const settings = new ArsSettingsService(prisma);
const pool = new NumberPoolService(prisma);
const integrity = new IntegrityService(prisma);
const sessions = new ArsSessionService(prisma, pool, settings, integrity);
const auth = new ApiKeyAuthService(prisma, redis);
sessions.sleep = async () => undefined; // never actually wait in tests

beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); await redis.onModuleDestroy(); });
beforeEach(async () => {
  await resetDb(prisma);
  await settings.update({ authlogWaitSeconds: 1, cooldownSeconds: 0 }, 'test');
});

async function setup(n = 30, opts: Parameters<typeof seedClient>[1] = {}) {
  await pool.importInventory(numbers(n), LINES);
  const c = await seedClient(prisma, opts);
  const client = await auth.verify(c.identity);
  return { ...c, client };
}

async function vnOf(sessionId: string) {
  return prisma.arsSession.findUniqueOrThrow({ where: { sessionId } });
}

async function carrierLog(vn: string, an: string, at = new Date(), callId = `cid-${Math.random()}`) {
  await sessions.recordAuthLog({ vn, an, callStartTime: kst(at), callId });
}

// ------------------------------------------------------------------------------------------ pool

describe('number pool', () => {
  test('070 lines are assigned in inventory order (ordinal % lines)', async () => {
    await pool.importInventory(numbers(7), LINES);
    const rows = await prisma.virtualNumber.findMany({ orderBy: { ordinal: 'asc' } });
    expect(rows.map((r) => r.rn)).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => LINES[i % 3]));
    expect(sequentialRn(4, LINES)).toBe(LINES[1]);
    await expect(pool.importInventory(['050700952000', '050700952000'], LINES)).rejects.toThrow('DUPLICATE_NUMBERS');
    expect((await pool.importInventory(numbers(9), LINES)).created).toBe(2); // idempotent re-import
  });

  test('one random cycle hands out every number exactly once before reshuffling', async () => {
    await pool.importInventory(numbers(25), LINES);
    const until = new Date(Date.now() + 60_000);
    const first: string[] = [];
    for (let i = 0; i < 25; i++) {
      const l = await pool.lease(until);
      expect(l.cycleNo).toBe(1);
      first.push(l.vn);
      await pool.release(l.vnId, 0);
    }
    expect(new Set(first).size).toBe(25);
    expect(first).not.toEqual(numbers(25)); // not inventory order (1/25! chance of false failure)
    const next = await pool.lease(until);
    expect(next.cycleNo).toBe(2);
    expect((await prisma.vnCycle.findFirstOrThrow({ where: { cycleNo: 1 } })).completedAt).not.toBeNull();
  });

  test('busy numbers are passed over and used later in the same cycle; all busy -> NO_NUMBER_AVAILABLE', async () => {
    await pool.importInventory(numbers(3), LINES);
    const until = new Date(Date.now() + 60_000);
    const a = await pool.lease(until);
    const b = await pool.lease(until);
    const c = await pool.lease(until);
    expect(new Set([a.vn, b.vn, c.vn]).size).toBe(3);
    await expect(pool.lease(until)).rejects.toThrow('NO_NUMBER_AVAILABLE');
    await pool.release(b.vnId, 3600); // cooling down: still unavailable
    await expect(pool.lease(until)).rejects.toThrow('NO_NUMBER_AVAILABLE');
    await pool.release(a.vnId, 0);
    const d = await pool.lease(until); // cycle 2 starts; only a is free
    expect(d.vn).toBe(a.vn);
    expect(d.cycleNo).toBe(2);
  });

  test('concurrent leases never return the same number', async () => {
    await pool.importInventory(numbers(40), LINES);
    const until = new Date(Date.now() + 60_000);
    const got = await Promise.all(Array.from({ length: 20 }, () => pool.lease(until)));
    expect(new Set(got.map((g) => g.vn)).size).toBe(20);
  });

  test('disabled numbers are skipped', async () => {
    await pool.importInventory(numbers(3), LINES);
    const rows = await prisma.virtualNumber.findMany();
    await pool.setStatus(rows[0].id, 'DISABLED', 'admin');
    await pool.setStatus(rows[1].id, 'DISABLED', 'admin');
    const l = await pool.lease(new Date(Date.now() + 60_000));
    expect(l.vn).toBe(rows[2].vn);
  });

  test('secureShuffle is a permutation', () => {
    const s = secureShuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...s].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

// ------------------------------------------------------------------------------------------ sessions

describe('call verification', () => {
  test('success: one call, carrier AuthLog, confirm key 1 -> VERIFIED with phone returned once', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, { purpose: '로그인' });
    expect(r.dial_number).toMatch(/^0507-0095-2\d{3}$/);
    expect(r.notice).toContain('바로포인트');
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    const v = await sessions.verifyCall({ rn: s.rn, caller: 'sip:01097111104@1.2.3.4', uniqueId: 'u1', t0: new Date(), confirmKey: '1' });
    expect(v).toMatchObject({ result: 'OK' });
    const st = await sessions.status(client, r.session_id);
    expect(st).toMatchObject({ status: 'VERIFIED', phone: '01097111104', phone_masked: '010****1104' });
    // number released into cooldown
    expect((await prisma.virtualNumber.findUniqueOrThrow({ where: { id: s.vnId } })).leasedUntil).toBeNull();
  });

  test('spoofed SIP caller id without a matching carrier AuthLog is rejected (no_authlog)', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104'); // carrier saw the real number
    const v = await sessions.verifyCall({ rn: s.rn, caller: '01012347777', uniqueId: 'u2', t0: new Date(), confirmKey: '1' });
    expect(v).toEqual({ result: 'FAIL', reason: 'no_authlog' });
    expect((await vnOf(r.session_id)).status).toBe('PENDING');
  });

  test('hidden caller id and landline callers are refused', async () => {
    const { client } = await setup();
    await sessions.create(client, {});
    expect(await sessions.verifyCall({ rn: LINES[0], caller: 'anonymous', uniqueId: 'h1', t0: new Date(), confirmKey: '1' })).toEqual({ result: 'FAIL', reason: 'hidden_caller' });
    expect(await sessions.verifyCall({ rn: LINES[0], caller: '0212345678', uniqueId: 'h2', t0: new Date(), confirmKey: '1' })).toEqual({ result: 'FAIL', reason: 'not_mobile' });
    expect(isHiddenCaller('')).toBe(true);
    expect(normalizeKrPhone('+82 10-9711-1104')).toBe('01097111104');
  });

  test('caller who does not press 1 after the phishing notice fails the session', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'n1', t0: new Date(), confirmKey: '' })).toMatchObject({ result: 'FAIL', reason: 'not_confirmed' });
    expect((await vnOf(r.session_id)).status).toBe('FAILED');
  });

  test('two calls to the leased number (someone called first) -> multiple_calls, later calls -> second_call', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01055556666', new Date(Date.now() - 3000)); // attacker
    await carrierLog(s.vn, '01097111104');                            // real user
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01055556666', uniqueId: 'm1', t0: new Date(Date.now() - 3000), confirmKey: '1' })).toMatchObject({ result: 'FAIL', reason: 'multiple_calls' });
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'm2', t0: new Date(), confirmKey: '1' })).toMatchObject({ result: 'FAIL', reason: 'second_call' });
    expect((await vnOf(r.session_id)).status).toBe('FAILED');
  });

  test('success is immutable: a later call never changes a verified session', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'i1', t0: new Date(), confirmKey: '1' });
    await carrierLog(s.vn, '01055556666');
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01055556666', uniqueId: 'i2', t0: new Date(), confirmKey: '1' })).toMatchObject({ reason: 'second_call' });
    expect((await vnOf(r.session_id)).status).toBe('VERIFIED');
  });

  test('expected_phone mismatch fails', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, { expected_phone: '010-1111-2222' });
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'e1', t0: new Date(), confirmKey: '1' })).toMatchObject({ reason: 'phone_mismatch' });
  });

  test('PC mode: ARS returns a 2-digit code; wrong entries up to the limit fail, right entry verifies', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, { mode: 'PC' });
    let s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    const v = await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'p1', t0: new Date(), confirmKey: '1' });
    expect(v.result).toBe('OK');
    expect(v.pcCode).toMatch(/^[1-9][0-9]$/);
    expect((await sessions.status(client, r.session_id)).status).toBe('CALL_CONFIRMED');
    const wrong = v.pcCode === '10' ? '11' : '10';
    await sessions.submitPcCode(client, r.session_id, wrong);
    expect((await sessions.status(client, r.session_id)).status).toBe('CALL_CONFIRMED');
    const ok = await sessions.submitPcCode(client, r.session_id, v.pcCode!);
    expect(ok).toMatchObject({ status: 'VERIFIED', phone: '01097111104' });
    s = await vnOf(r.session_id);
    expect(s.pcCode).toBeNull();

    const r2 = await sessions.create(client, { mode: 'PC' });
    const s2 = await vnOf(r2.session_id);
    await carrierLog(s2.vn, '01097111104');
    const v2 = await sessions.verifyCall({ rn: s2.rn, caller: '01097111104', uniqueId: 'p2', t0: new Date(), confirmKey: '1' });
    const bad = v2.pcCode === '10' ? '11' : '10';
    for (let i = 0; i < 3; i++) await sessions.submitPcCode(client, r2.session_id, bad);
    expect((await sessions.status(client, r2.session_id))).toMatchObject({ status: 'FAILED', fail_reason: 'pc_code_wrong' });
  });

  test('expiry releases the number; cancel works only while active', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, {});
    const realNow = sessions.now;
    sessions.now = () => new Date(Date.now() + 120_000);
    expect(await sessions.expireDue()).toBe(1);
    sessions.now = realNow;
    expect((await sessions.status(client, r.session_id))).toMatchObject({ status: 'EXPIRED', fail_reason: 'timeout' });
    await expect(sessions.cancel(client, r.session_id)).rejects.toThrow('SESSION_NOT_ACTIVE');
    const r2 = await sessions.create(client, {});
    expect((await sessions.cancel(client, r2.session_id)).status).toBe('CANCELED');
  });

  test('a session belongs to its API key only', async () => {
    const { client } = await setup();
    const other = await seedClient(prisma);
    const otherClient = await auth.verify(other.identity);
    const r = await sessions.create(client, {});
    await expect(sessions.status(otherClient, r.session_id)).rejects.toThrow('SESSION_NOT_FOUND');
  });

  test('AuthLog is idempotent on callId and parses KST timestamps', async () => {
    await carrierLog('050700952000', '01097111104', new Date(), 'same');
    await carrierLog('050700952000', '01097111104', new Date(), 'same');
    expect(await prisma.authLogEvent.count()).toBe(1);
    expect(parseKstDateTime('2026-10-21 16:52:03')!.toISOString()).toBe('2026-10-21T07:52:03.000Z');
  });
});

// ------------------------------------------------------------------------------------------ api key

describe('api key auth', () => {
  test('wrong app, platform or package is refused; monthly limit enforced', async () => {
    await pool.importInventory(numbers(5), LINES);
    const c = await seedClient(prisma, { monthlyLimit: 1 });
    await expect(auth.verify({ ...c.identity, mobile_app_name: 'Other' })).rejects.toThrow('APP_NOT_ALLOWED');
    await expect(auth.verify({ ...c.identity, package_name: 'com.evil.clone' })).rejects.toThrow('APP_NOT_ALLOWED');
    await expect(auth.verify({ ...c.identity, client_platform: 'WEB' })).rejects.toThrow('PLATFORM_NOT_ALLOWED');
    await expect(auth.verify({ ...c.identity, api_key: 'nope' })).rejects.toThrow('UNAUTHORIZED_API_KEY');
    const client = await auth.verify(c.identity);
    await sessions.create(client, {});
    await expect(auth.verify(c.identity)).rejects.toThrow('MONTHLY_LIMIT_EXCEEDED');
  });
});

// ------------------------------------------------------------------------------------------ integrity

describe('app integrity', () => {
  test('ENFORCE without proof refuses before leasing a number; MONITOR records NOT_PROVIDED', async () => {
    const { client } = await setup(5, { policy: 'ENFORCE' });
    await expect(sessions.create(client, {})).rejects.toMatchObject({ response: { code: 'APP_INTEGRITY_FAILED' } });
    expect(await prisma.virtualNumber.count({ where: { leasedUntil: { not: null } } })).toBe(0);
    const m = await seedClient(prisma, { policy: 'MONITOR' });
    const mc = await auth.verify(m.identity);
    const r = await sessions.create(mc, {});
    expect(r.integrity).toBe('NOT_PROVIDED');
  });

  test('Android: unconfigured Play Integrity is an ERROR verdict; challenge is single use', async () => {
    const { client } = await setup(5, { policy: 'MONITOR' });
    integrity.play = new PlayIntegrityVerifier(undefined);
    const ch = await integrity.challenge(client.apiKeyId, client.app.id);
    const r = await sessions.create(client, { integrity_nonce: ch.nonce, integrity_token: 'tok' });
    expect(r.integrity).toBe('ERROR');
    const r2 = await sessions.create(client, { integrity_nonce: ch.nonce, integrity_token: 'tok' });
    expect(r2.integrity).toBe('FAILED'); // reused challenge
  });

  test('Play Integrity verdict evaluation', () => {
    const now = Date.now();
    const good = { requestDetails: { requestPackageName: 'com.example.bspoint', nonce: 'N1', timestampMillis: String(now) },
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'com.example.bspoint', certificateSha256Digest: ['CERT'] },
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] } };
    expect(PlayIntegrityVerifier.evaluate(good, { packageName: 'com.example.bspoint', nonce: 'N1', certSha256: ['CERT'], now }).ok).toBe(true);
    const bad = { ...good, appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', certificateSha256Digest: ['OTHER'] }, deviceIntegrity: { deviceRecognitionVerdict: [] } };
    const v = PlayIntegrityVerifier.evaluate(bad, { packageName: 'com.example.bspoint', nonce: 'N2', certSha256: ['CERT'], now: now + 600_000 });
    expect(v.reasons).toEqual(expect.arrayContaining(['nonce_mismatch', 'stale_token', 'app_unrecognized_version', 'signing_cert_mismatch', 'device_integrity']));
  });

  test('iOS: App Attest assertion with a registered key passes once; replayed counter fails', async () => {
    const { client } = await setup(5, { policy: 'ENFORCE', platform: 'IOS' });
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    await prisma.appAttestKey.create({ data: { applicationAppId: client.app.id, keyId: 'KEY1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), environment: 'appattestdevelop', signCount: 0 } });
    const appId = 'ABCDE12345.com.example.bsPoint';
    const assertion = (challenge: string, counter: number) => {
      const authData = Buffer.alloc(37);
      createHash('sha256').update(appId).digest().copy(authData, 0);
      authData.writeUInt32BE(counter, 33);
      const nonce = createHash('sha256').update(Buffer.concat([authData, createHash('sha256').update(challenge).digest()])).digest();
      const sig = cryptoSign('sha256', nonce, privateKey);
      // CBOR map {"signature": bytes, "authenticatorData": bytes}
      const bstr = (b: Buffer) => Buffer.concat([Buffer.from([0x58, b.length]), b]);
      const tstr = (s: string) => Buffer.concat([Buffer.from([0x60 + s.length]), Buffer.from(s)]);
      return Buffer.concat([Buffer.from([0xa2]), tstr('signature'), bstr(sig), tstr('authenticatorData'), bstr(authData)]).toString('base64');
    };
    const ch1 = await integrity.challenge(client.apiKeyId, client.app.id);
    const ok = await sessions.create(client, { integrity_nonce: ch1.nonce, attest_key_id: 'KEY1', attest_assertion: assertion(ch1.nonce, 1) });
    expect(ok.integrity).toBe('PASSED');
    const ch2 = await integrity.challenge(client.apiKeyId, client.app.id);
    await expect(sessions.create(client, { integrity_nonce: ch2.nonce, attest_key_id: 'KEY1', attest_assertion: assertion(ch2.nonce, 1) }))
      .rejects.toMatchObject({ response: { code: 'APP_INTEGRITY_FAILED' } });
    const ch3 = await integrity.challenge(client.apiKeyId, client.app.id);
    await expect(sessions.create(client, { integrity_nonce: ch3.nonce, attest_key_id: 'KEY1', attest_assertion: assertion('other-challenge', 2) }))
      .rejects.toMatchObject({ response: { code: 'APP_INTEGRITY_FAILED' } });
  });

  test('CBOR decoder and phone sealing', () => {
    expect(decodeCbor(Buffer.from([0xa1, 0x61, 0x61, 0x83, 0x01, 0x20, 0x43, 1, 2, 3]))).toEqual(new Map([['a', [1, -1, Buffer.from([1, 2, 3])]]]));
    expect(() => decodeCbor(Buffer.from([0x5f]))).toThrow();
    expect(openText(sealText('01097111104'))).toBe('01097111104');
  });
});

// ------------------------------------------------------------------------------------------ settings

describe('settings', () => {
  test('validated and audited', async () => {
    await expect(settings.update({ leaseSecondsApp: 5 }, 'a')).rejects.toThrow();
    await expect(settings.update({ confirmKeyRequired: 'yes' as never }, 'a')).rejects.toThrow();
    const s = await settings.update({ leaseSecondsApp: 90, pcCodeEnabled: false }, 'a');
    expect(s).toMatchObject({ leaseSecondsApp: 90, pcCodeEnabled: false });
    expect(await prisma.auditLog.count({ where: { action: 'ARS_SETTINGS_UPDATE' } })).toBeGreaterThan(0);
  });
});
