import { generateKeyPairSync, createHash, sign as cryptoSign } from 'crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { ApiKeyAuthService } from '../src/modules/ars-engine/api-key-auth.service';
import { ArsSessionService, parseKstDateTime } from '../src/modules/ars-engine/ars-session.service';
import { ArsSettingsService } from '../src/modules/ars-engine/ars-settings.service';
import { IntegrityService } from '../src/modules/ars-engine/integrity/integrity.service';
import { NumberPoolService, secureShuffle, sequentialRn } from '../src/modules/ars-engine/number-pool.service';
import { CarrierRequest, CarrierService } from '../src/modules/ars-engine/carrier.service';
import { PlayIntegrityVerifier } from '../src/modules/ars-engine/integrity/play-integrity';
import { decodeCbor } from '../src/modules/ars-engine/integrity/cbor';
import { isHiddenCaller, normalizeKrPhone, openText, sealText } from '../src/modules/ars-engine/phone.util';
import { kst, LINES, numbers, resetDb, seedClient, TEST_KEY } from './helpers';
import { hmacSha256 } from '../src/common/crypto.util';

const prisma = new PrismaService();
const redis = new RedisService();
const settings = new ArsSettingsService(prisma);
const pool = new NumberPoolService(prisma);
const integrity = new IntegrityService(prisma);
const carrier = new CarrierService(prisma);
/** fake CallMix: records every call; numbers in failVns are refused */
const carrierCalls: CarrierRequest[] = [];
const failVns = new Set<string>();
carrier.client = async (req) => { carrierCalls.push(req); return failVns.has(req.vn) ? { resCd: 'FAIL', resMsg: '\uc2e4\ud328' } : { resCd: 'SUCCESS', resMsg: '' }; };
const sessions = new ArsSessionService(prisma, pool, settings, integrity, carrier);
const auth = new ApiKeyAuthService(prisma, redis);
sessions.sleep = async () => undefined; // never actually wait in tests

beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); await redis.onModuleDestroy(); });
beforeEach(async () => {
  await resetDb(prisma);
  carrierCalls.length = 0;
  failVns.clear();
  await settings.update({ authlogWaitSeconds: 1, cooldownSeconds: 0 }, 'test');
});

async function setup(n = 30, opts: Parameters<typeof seedClient>[1] = {}) {
  await pool.importInventory(numbers(n), LINES);
  const c = await seedClient(prisma, opts);
  const client = await auth.verify(c.identity);
  return { ...c, client };
}

/** Identity for an existing app with a fresh API key of its application (bypasses the redis key cache). */
async function seedIdentity(appId: string) {
  const app = await prisma.applicationApp.findUniqueOrThrow({ where: { id: appId } });
  const key = `${TEST_KEY}${Math.random().toString(36).slice(2, 8)}`;
  await prisma.apiKey.create({ data: { applicationId: app.applicationId, keyPrefix: key.slice(0, 14), keyHash: hmacSha256(process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret', key), status: 'ACTIVE', monthlyLimit: 10000, rateLimitPerMinute: 1000 } });
  return { api_key: key, mobile_app_name: app.mobileAppName, client_platform: app.platform as 'ANDROID' | 'IOS', package_name: app.packageName ?? undefined, bundle_id: app.bundleId ?? undefined };
}
async function vnOf(sessionId: string) {
  return prisma.arsSession.findUniqueOrThrow({ where: { sessionId } });
}

async function carrierLog(vn: string, an: string, at = new Date(), callId = `cid-${Math.random()}`) {
  await sessions.recordAuthLog({ vn, an, callStartTime: kst(at), callId });
}

/** pool mechanics without the carrier: numbers that are always forwarded */
async function staticOnly() { await prisma.virtualNumber.updateMany({ data: { routing: 'STATIC' } }); }

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
    await staticOnly();
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
    await staticOnly();
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
    await staticOnly();
    const until = new Date(Date.now() + 60_000);
    const got = await Promise.all(Array.from({ length: 20 }, () => pool.lease(until)));
    expect(new Set(got.map((g) => g.vn)).size).toBe(20);
  });

  test('disabled numbers are skipped', async () => {
    await pool.importInventory(numbers(3), LINES);
    await staticOnly();
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

  test('PC mode: QR page, connect shows the code on the PC, phone keys it in (DTMF) -> VERIFIED; wrong code or no input fails', async () => {
    const { client } = await setup();
    await expect(sessions.create(client, { mode: 'PC' })).rejects.toThrow('EXPECTED_PHONE_REQUIRED');
    await expect(sessions.create(client, { mode: 'PC', expected_phone: '01097111104', country_code: '1' })).rejects.toThrow('UNSUPPORTED_COUNTRY_CODE');
    const r = await sessions.create(client, { mode: 'PC', expected_phone: '010-9711-1104', country_code: '82' });
    // the PC never gets the number, only the one-time mobile page
    expect(r).not.toHaveProperty('dial_number');
    expect(r.dial_page_url).toMatch(/\/m\/ars\/[A-Za-z0-9_-]{24}$/);
    const token = r.dial_page_url!.split('/').pop()!;
    const page = await sessions.dialPage(token);
    expect(page).toMatchObject({ state: 'READY' });
    expect(page.tel).toMatch(/^tel:0507-0095-2\d{3}$/);
    expect(await sessions.dialPage('x'.repeat(24))).toMatchObject({ state: 'NOT_FOUND' });
    expect((await sessions.status(client, r.session_id))).not.toHaveProperty('pc_code');

    let s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    const c1 = await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'p1', t0: new Date(), phase: 'connect' });
    expect(c1).toMatchObject({ result: 'OK', mode: 'PC', digits: 4 });
    const st = await sessions.status(client, r.session_id);
    expect(st).toMatchObject({ status: 'CALL_CONFIRMED', code_seconds: 15 });
    expect(st.pc_code).toMatch(/^[0-9]{4}$/);
    expect(new Date(st.code_expires_at as string).getTime()).toBeGreaterThan(Date.now() + 12_000);
    expect(c1.readTimeout).toBe(9); // 15 s minus the 6 s guidance prompt
    // forwarding switched back as soon as the call is connected (immediate carrier call, no sweeper needed)
    await new Promise((res) => setTimeout(res, 300));
    expect(carrierCalls).toContainEqual({ vn: s.vn, rn: s.rn, link: false });
    expect((await prisma.virtualNumber.findUniqueOrThrow({ where: { id: s.vnId } })).linkState).toBe('OFF');
    expect((await sessions.dialPage(token)).state).toBe('CONNECTED');
    expect(await sessions.submitPhoneCode('p1', st.pc_code as string)).toMatchObject({ result: 'OK' });
    expect(await sessions.status(client, r.session_id)).toMatchObject({ status: 'VERIFIED', phone: '01097111104' });
    s = await vnOf(r.session_id);
    expect(s.pcCode).toBeNull();
    expect(await sessions.submitPhoneCode('p1', '0000')).toMatchObject({ result: 'FAIL', reason: 'second_call' });

    // wrong code: one try only
    const r2 = await sessions.create(client, { mode: 'PC', expected_phone: '01097111104' });
    const s2 = await vnOf(r2.session_id);
    await carrierLog(s2.vn, '01097111104');
    await sessions.verifyCall({ rn: s2.rn, caller: '01097111104', uniqueId: 'p2', t0: new Date(), phase: 'connect' });
    const code2 = (await sessions.status(client, r2.session_id)).pc_code as string;
    const bad = code2 === '0000' ? '1111' : '0000';
    expect(await sessions.submitPhoneCode('p2', bad)).toMatchObject({ result: 'FAIL', reason: 'pc_code_wrong' });
    expect(await sessions.status(client, r2.session_id)).toMatchObject({ status: 'FAILED', fail_reason: 'pc_code_wrong' });

    // no input in time (Read timed out: empty code) -> code_timeout
    const r3 = await sessions.create(client, { mode: 'PC', expected_phone: '01097111104' });
    const s3 = await vnOf(r3.session_id);
    await carrierLog(s3.vn, '01097111104');
    await sessions.verifyCall({ rn: s3.rn, caller: '01097111104', uniqueId: 'p3', t0: new Date(), phase: 'connect' });
    expect(await sessions.submitPhoneCode('p3', '')).toMatchObject({ result: 'FAIL', reason: 'code_timeout' });

    // the call never reports back: the sweeper fails the session once the code window is over
    const r4 = await sessions.create(client, { mode: 'PC', expected_phone: '01097111104' });
    const s4 = await vnOf(r4.session_id);
    await carrierLog(s4.vn, '01097111104');
    await sessions.verifyCall({ rn: s4.rn, caller: '01097111104', uniqueId: 'p4', t0: new Date(), phase: 'connect' });
    const realNow = sessions.now;
    sessions.now = () => new Date(Date.now() + 40_000);
    await sessions.expireDue();
    sessions.now = realNow;
    expect(await sessions.status(client, r4.session_id)).toMatchObject({ status: 'FAILED', fail_reason: 'code_timeout' });
  });

  test('per-app setting: press-1 off -> connect says confirm=false and the call verifies without a key', async () => {
    const { client, app } = await setup();
    await prisma.applicationApp.update({ where: { id: app.id }, data: { confirmKeyRequired: false } });
    void client;
    const c2 = await auth.verify(await seedIdentity(app.id));
    const r = await sessions.create(c2, {});
    const s = await vnOf(r.session_id);
    expect(s.confirmKey).toBe(false);
    await carrierLog(s.vn, '01097111104');
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'nc1', t0: new Date(), phase: 'connect' })).toMatchObject({ result: 'OK', mode: 'APP', confirm: false });
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'nc1', t0: new Date(), confirmKey: '' })).toMatchObject({ result: 'OK' });
    // back to the system default (on): a new session needs the key again
    await prisma.applicationApp.update({ where: { id: app.id }, data: { confirmKeyRequired: null } });
    const r2 = await sessions.create(await auth.verify(await seedIdentity(app.id)), {});
    expect((await vnOf(r2.session_id)).confirmKey).toBe(true);
  });
  test('PC mode: a different phone than the one typed on the PC fails at connect', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, { mode: 'PC', expected_phone: '01011112222' });
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'pm', t0: new Date(), phase: 'connect' })).toMatchObject({ result: 'FAIL', reason: 'phone_mismatch' });
    expect((await vnOf(r.session_id)).status).toBe('FAILED');
  });

  test('APP mode via connect: connect says APP (no state change), then notice + 1 verifies', async () => {
    const { client } = await setup();
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'a1', t0: new Date(), phase: 'connect' })).toMatchObject({ result: 'OK', mode: 'APP' });
    expect((await vnOf(r.session_id)).status).toBe('PENDING');
    expect(await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'a1', t0: new Date(), confirmKey: '1' })).toMatchObject({ result: 'OK' });
    expect((await vnOf(r.session_id)).status).toBe('VERIFIED');
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
    const s = await settings.update({ leaseSecondsApp: 90, pcCodeDigits: 6 }, 'a');
    expect(s).toMatchObject({ leaseSecondsApp: 90, pcCodeDigits: 6 });
    expect(await prisma.auditLog.count({ where: { action: 'ARS_SETTINGS_UPDATE' } })).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------ carrier (CallMix forwarding)

describe('CallMix forwarding per lease', () => {
  const vnRow = (id: number) => prisma.virtualNumber.findUniqueOrThrow({ where: { id } });

  test('forwarding is switched on before the number is handed out, and off when the window closes', async () => {
    const { client } = await setup(5);
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    expect(carrierCalls).toEqual([{ vn: s.vn, rn: s.rn, link: true }]);
    expect(r.expires_in).toBe(30);
    let n = await vnRow(s.vnId);
    expect(n.linkState).toBe('ON');
    expect(n.unlinkAfter!.getTime()).toBe(new Date(r.expires_at).getTime());
    // nothing due yet
    expect(await pool.unlinkDue(carrier, new Date())).toEqual({ done: 0, failed: 0 });
    // 30 s later the forwarding goes off even though the session waits a little longer for a late call
    expect(await pool.unlinkDue(carrier, new Date(Date.now() + 31_000))).toEqual({ done: 1, failed: 0 });
    expect(carrierCalls[1]).toEqual({ vn: s.vn, rn: s.rn, link: false });
    n = await vnRow(s.vnId);
    expect(n.linkState).toBe('OFF');
    expect((await vnOf(r.session_id)).status).toBe('PENDING');
  });

  test('a decided call switches the forwarding back at once (success or failure)', async () => {
    const { client } = await setup(5);
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    await carrierLog(s.vn, '01097111104');
    expect((await sessions.verifyCall({ rn: s.rn, caller: '01097111104', uniqueId: 'hx1', t0: new Date(), confirmKey: '1' })).result).toBe('OK');
    await new Promise((res) => setTimeout(res, 300));
    expect(carrierCalls).toContainEqual({ vn: s.vn, rn: s.rn, link: false });
    expect((await vnRow(s.vnId)).linkState).toBe('OFF');
    await sessions.callEnded('hx1');
    expect((await prisma.pbxCall.findUniqueOrThrow({ where: { uniqueId: 'hx1' } })).endedAt).not.toBeNull();

    // a failed call (other phone than expected) too
    const r2 = await sessions.create(client, { mode: 'PC', expected_phone: '01011112222' });
    const s2 = await vnOf(r2.session_id);
    await carrierLog(s2.vn, '01097111104');
    expect(await sessions.verifyCall({ rn: s2.rn, caller: '01097111104', uniqueId: 'hx2', t0: new Date(), phase: 'connect' })).toMatchObject({ reason: 'phone_mismatch' });
    await new Promise((res) => setTimeout(res, 300));
    expect((await vnRow(s2.vnId)).linkState).toBe('OFF');
  });
  test('a refused number is skipped (next number tried) and is never handed out until switched off', async () => {
    const { client } = await setup(3);
    const all = await prisma.virtualNumber.findMany({ orderBy: { ordinal: 'asc' } });
    // carrier refuses everything -> 503 after trying 3 numbers
    all.forEach((x) => failVns.add(x.vn));
    await expect(sessions.create(client, {})).rejects.toMatchObject({ response: { code: 'CARRIER_UNAVAILABLE' } });
    expect((await prisma.virtualNumber.findMany()).every((x) => x.linkState === 'UNKNOWN')).toBe(true);
    // refused numbers are switched off by the sweeper before they can be used again
    failVns.clear();
    expect((await pool.unlinkDue(carrier, new Date(Date.now() + 1000))).done).toBe(3);
    await prisma.virtualNumber.updateMany({ data: { cooldownUntil: null } });
    // now two of three are refused: the session gets the third
    failVns.add(all[0].vn); failVns.add(all[1].vn);
    const r = await sessions.create(client, {});
    expect((await vnOf(r.session_id)).vn).toBe(all[2].vn);
  });
  test('a failed switch-off is retried with backoff and the number stays out of the pool meanwhile', async () => {
    const { client } = await setup(1);
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    await sessions.cancel(client, r.session_id);
    failVns.add(s.vn);
    expect(await pool.unlinkDue(carrier, new Date(Date.now() + 100))).toEqual({ done: 0, failed: 1 });
    let n = await vnRow(s.vnId);
    expect(n.linkState).toBe('UNKNOWN');
    expect(n.linkFailCount).toBe(1);
    expect(n.unlinkAfter!.getTime()).toBeGreaterThan(Date.now());
    await expect(sessions.create(client, {})).rejects.toThrow('NO_NUMBER_AVAILABLE');
    failVns.clear();
    expect(await pool.unlinkDue(carrier, new Date(Date.now() + 61_000))).toEqual({ done: 1, failed: 0 });
    n = await vnRow(s.vnId);
    expect(n).toMatchObject({ linkState: 'OFF', linkFailCount: 0 });
    expect((await sessions.create(client, {})).dial_number).toBeTruthy();
  });

  test('precheck: calls are expected on a 070 only while a session waits there', async () => {
    const { client } = await setup(3);
    expect(await sessions.precheck(LINES[0])).toBe(false);
    const r = await sessions.create(client, {});
    const s = await vnOf(r.session_id);
    expect(await sessions.precheck(s.rn)).toBe(true);
    expect(await sessions.precheck(LINES.find((l) => l !== s.rn)!)).toBe(false);
    await sessions.cancel(client, r.session_id);
    expect(await sessions.precheck(s.rn)).toBe(false);
  });

  test('precheck records calls that are not part of any authentication', async () => {
    await setup(3);
    expect(await sessions.precheck('07051901900', 'g1', '01097111104')).toBe(false);
    expect(await prisma.pbxCall.findUniqueOrThrow({ where: { uniqueId: 'g1' } })).toMatchObject({ result: 'FAIL', reason: 'invalid_access', callerMasked: '010****1104' });
  });
  test('STATIC numbers are used without any carrier call; without credentials DYNAMIC numbers are not leased', async () => {
    const { client } = await setup(2);
    const rows = await prisma.virtualNumber.findMany({ orderBy: { ordinal: 'asc' } });
    await prisma.virtualNumber.update({ where: { id: rows[0].id }, data: { routing: 'STATIC' } });
    const saved = carrier.client;
    carrier.client = null;
    try {
      const r = await sessions.create(client, {});
      expect((await vnOf(r.session_id)).vn).toBe(rows[0].vn);
      await expect(sessions.create(client, {})).rejects.toThrow('NO_NUMBER_AVAILABLE');
    } finally {
      carrier.client = saved;
    }
    expect(carrierCalls).toHaveLength(0);
  });

  test('CallMix client sends linkYn, rn, coloring/comment 0 and parses resCd', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ resCd: 'SUCCESS', resMsg: '' }), { status: 200 }));
    try {
      const c = CarrierService.fromEnv({ CALLMIX_ID: 'idx', CALLMIX_PW: 'pwx' } as NodeJS.ProcessEnv)!;
      expect(await c({ vn: '050700952000', rn: '07051901950', link: false })).toEqual({ resCd: 'SUCCESS', resMsg: '' });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://m.callmix.co.kr/cmxapi/vnMapping');
      const body = Object.fromEntries(new URLSearchParams(String(init.body)));
      expect(body).toMatchObject({ id: 'idx', pw: 'pwx', vn: '050700952000', rn: '07051901950', linkYn: 'n', colorRing: '0', callMent: '0' });
      expect(CarrierService.fromEnv({} as NodeJS.ProcessEnv)).toBeNull();
      // guard mode: "off" forwards to the guard line (answered with the invalid-access message); "on" to the assigned 070
      const g = CarrierService.fromEnv({ CALLMIX_ID: 'idx', CALLMIX_PW: 'pwx', CALLMIX_GUARD_RN: '070-5190-1900' } as NodeJS.ProcessEnv)!;
      await g({ vn: '050700952000', rn: '07051901950', link: false });
      await g({ vn: '050700952000', rn: '07051901950', link: true });
      const off = Object.fromEntries(new URLSearchParams(String((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body)));
      const on = Object.fromEntries(new URLSearchParams(String((fetchSpy.mock.calls[2] as [string, RequestInit])[1].body)));
      expect(off).toMatchObject({ rn: '07051901900', linkYn: 'y' });
      expect(on).toMatchObject({ rn: '07051901950', linkYn: 'y' });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});