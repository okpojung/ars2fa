import { AutoApproveService } from '../src/modules/admin/auto-approve.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { corsDelegate } from '../src/common/cors';
import { PrismaService } from '../src/prisma/prisma.service';
import { NumberPoolService } from '../src/modules/ars-engine/number-pool.service';
import { ArsSessionService } from '../src/modules/ars-engine/ars-session.service';
import { CarrierService } from '../src/modules/ars-engine/carrier.service';
import { kst, LINES, numbers, resetDb, seedClient } from './helpers';

const KEY = 'k'.repeat(40);
let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  process.env.INTERNAL_API_KEY = KEY;
  process.env.WIDGET_LIMITS = 'off';
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.enableCors(corsDelegate);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  prisma = app.get(PrismaService);
  app.get(ArsSessionService).sleep = async () => undefined;
  app.get(CarrierService).client = async () => ({ resCd: 'SUCCESS', resMsg: '' });
});
afterAll(async () => { await app.close(); });
beforeEach(async () => { await resetDb(prisma); });

test('end to end: create session -> AuthLog -> PBX verify -> status', async () => {
  await app.get(NumberPoolService).importInventory(numbers(10), LINES);
  const c = await seedClient(prisma);
  const created = await request(app.getHttpServer()).post('/v1/ars/sessions').set('Authorization', `Bearer ${c.key}`)
    .send({ mobile_app_name: c.identity.mobile_app_name, client_platform: 'ANDROID', package_name: c.identity.package_name, purpose: '로그인' }).expect(201);
  const s = await prisma.arsSession.findUniqueOrThrow({ where: { sessionId: created.body.session_id } });

  await request(app.getHttpServer()).post('/internal/authlog').set('X-Internal-Key', KEY)
    .send({ vn: s.vn, an: '01097111104', callStartTime: kst(new Date()), callId: '777' }).expect(200);
  const v = await request(app.getHttpServer()).post('/internal/pbx/verify')
    .type('form').send({ rn: s.rn, caller: '01097111104', uid: 'abc.1', t0: String(Math.floor(Date.now() / 1000)), confirm: '1', key: KEY }).expect(200);
  expect(v.text).toBe('OK');

  const st = await request(app.getHttpServer()).post('/v1/ars/sessions/status')
    .send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'ANDROID', package_name: c.identity.package_name, session_id: created.body.session_id }).expect(200);
  expect(st.body).toMatchObject({ status: 'VERIFIED', phone: '01097111104' });
});

test('PC mode end to end over HTTP: dial page -> PBX connect -> code shown -> PBX code', async () => {
  const srv = app.getHttpServer();
  await app.get(NumberPoolService).importInventory(numbers(10), LINES);
  const c = await seedClient(prisma);
  const created = await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${c.key}`)
    .send({ mobile_app_name: c.identity.mobile_app_name, client_platform: 'ANDROID', package_name: c.identity.package_name, mode: 'PC', country_code: '82', expected_phone: '01097111104' }).expect(201);
  expect(created.body.dial_page_url).toBeTruthy();
  expect(created.body.dial_number).toBeUndefined();
  const token = String(created.body.dial_page_url).split('/').pop();
  const page = await request(srv).get(`/api/public/ars/dial/${token}`).expect(200);
  expect(page.body).toMatchObject({ state: 'READY' });
  const s = await prisma.arsSession.findUniqueOrThrow({ where: { sessionId: created.body.session_id } });

  // a resting number / no waiting session -> NO
  const pre0 = await request(srv).post('/internal/pbx/precheck').type('form').send({ rn: '07051901900', uid: 'x.0', caller: '01097111104', key: KEY }).expect(200);
  expect(pre0.text).toBe('NO');
  const pre = await request(srv).post('/internal/pbx/precheck').type('form').send({ rn: s.rn, uid: 'pc.1', caller: '01097111104', key: KEY }).expect(200);
  expect(pre.text).toBe('OK');
  await request(srv).post('/internal/authlog').set('X-Internal-Key', KEY)
    .send({ vn: s.vn, an: '01097111104', callStartTime: kst(new Date()), callId: '888' }).expect(200);
  const con = await request(srv).post('/internal/pbx/connect').type('form')
    .send({ rn: s.rn, caller: '01097111104', uid: 'pc.1', t0: String(Math.floor(Date.now() / 1000)), key: KEY }).expect(200);
  expect(con.text).toBe('PC:4:11');
  const st = await request(srv).post('/v1/ars/sessions/status')
    .send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'ANDROID', package_name: c.identity.package_name, session_id: created.body.session_id }).expect(200);
  expect(st.body.status).toBe('CALL_CONFIRMED');
  expect(st.body.pc_code).toMatch(/^[0-9]{4}$/);
  expect(st.body.server_time).toBeTruthy();
  const code = await request(srv).post('/internal/pbx/code').type('form').send({ uid: 'pc.1', code: st.body.pc_code, key: KEY }).expect(200);
  expect(code.text).toBe('OK');
  await request(srv).post('/internal/pbx/hangup').type('form').send({ uid: 'pc.1', key: KEY }).expect(200);
  const done = await request(srv).post('/v1/ars/sessions/status')
    .send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'ANDROID', package_name: c.identity.package_name, session_id: created.body.session_id }).expect(200);
  expect(done.body).toMatchObject({ status: 'VERIFIED', phone: '01097111104' });
});
test('customer console: own sessions, per-app press-1 setting, key issue/rotate; no hashes in responses', async () => {
  const srv = app.getHttpServer();
  await app.get(NumberPoolService).importInventory(numbers(10), LINES);
  const email = `cust${Date.now()}@ex.com`;
  await request(srv).post('/api/auth/signup').send({ email, password: 'Abcd123!', companyName: 'Co', contactName: 'N', contactPhone: '01000000000' }).expect(201);
  const login = await request(srv).post('/api/auth/login').send({ email, password: 'Abcd123!' }).expect(201);
  expect(JSON.stringify(login.body)).not.toContain('passwordHash');
  const auth = { Authorization: `Bearer ${login.body.accessToken}` };
  const created = await request(srv).post('/api/applications').set(auth)
    .send({ serviceName: 'Svc', usagePurpose: 'login', expectedMonthlyRequests: 100, apps: [{ mobileAppName: 'MyApp', platform: 'ANDROID', packageName: 'com.my.app' }] }).expect(201);
  // approve the way the admin does (key row created, secret not known to the customer yet)
  const appRow = await prisma.applicationApp.findFirstOrThrow({ where: { applicationId: created.body.id } });
  await prisma.apiApplication.update({ where: { id: created.body.id }, data: { status: 'APPROVED' } });
  await prisma.applicationApp.update({ where: { id: appRow.id }, data: { status: 'APPROVED', integrityPolicy: 'OFF' } });
  const keyRow = await prisma.apiKey.create({ data: { applicationId: created.body.id, keyPrefix: 'ars_test_xxxx', keyHash: 'h-' + Date.now(), status: 'ACTIVE', monthlyLimit: 100, rateLimitPerMinute: 60 } });

  const keys = await request(srv).get('/api/api-keys').set(auth).expect(200);
  expect(JSON.stringify(keys.body)).not.toMatch(/keyHash|passwordHash/);
  const detail = await request(srv).get(`/api/applications/${created.body.id}`).set(auth).expect(200);
  expect(JSON.stringify(detail.body)).not.toMatch(/keyHash|passwordHash/);

  // the key is shown only after an ARS check of the account's contact phone
  await request(srv).post(`/api/console/api-keys/${keyRow.id}/rotate`).set(auth).send({}).expect(400);
  const kp = await request(srv).post('/api/console/api-keys/phone/start').set(auth).set('Origin', 'https://ars2fa.baro.me').expect(201);
  await request(srv).post(`/api/console/api-keys/${keyRow.id}/rotate`).set(auth).send({ phoneSessionId: kp.body.session_id }).expect(400); // not verified yet
  await completePcCall(kp.body.session_id, '01000000000', 'key.1');
  const rot = await request(srv).post(`/api/console/api-keys/${keyRow.id}/rotate`).set(auth).send({ phoneSessionId: kp.body.session_id }).expect(201);
  expect(rot.body.apiKey).toBeTruthy();
  // one use only
  await request(srv).post(`/api/console/api-keys/${keyRow.id}/rotate`).set(auth).send({ phoneSessionId: kp.body.session_id }).expect(400);
  const id = { mobile_app_name: 'MyApp', client_platform: 'ANDROID', package_name: 'com.my.app' };
  await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${rot.body.apiKey}`).send(id).expect(201);

  // press-1 off for this app
  const set = await request(srv).patch(`/api/console/apps/${appRow.id}/settings`).set(auth).send({ confirmKeyRequired: false, displayName: '내 앱' }).expect(200);
  expect(set.body).toMatchObject({ confirmKeyRequired: false, displayName: '내 앱' });
  const s2 = await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${rot.body.apiKey}`).send(id).expect(201);
  expect(s2.body.display_name).toBe('내 앱');
  expect((await prisma.arsSession.findUniqueOrThrow({ where: { sessionId: s2.body.session_id } })).confirmKey).toBe(false);

  // rotating again invalidates the previous secret
  const kp2 = await request(srv).post('/api/console/api-keys/phone/start').set(auth).set('Origin', 'https://ars2fa.baro.me').expect(201);
  await completePcCall(kp2.body.session_id, '01000000000', 'key.2');
  const rot2 = await request(srv).post(`/api/console/api-keys/${keyRow.id}/rotate`).set(auth).send({ phoneSessionId: kp2.body.session_id }).expect(201);
  await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${rot.body.apiKey}`).send(id).expect(401);
  expect(rot2.body.apiKey).not.toBe(rot.body.apiKey);

  // view the issued key again: ARS check first, same key, never in lists
  const listed = await request(srv).get('/api/api-keys').set(auth).expect(200);
  expect(listed.body.find((k: { id: string }) => k.id === keyRow.id)).toMatchObject({ viewable: true });
  expect(JSON.stringify(listed.body)).not.toContain('keyEnc');
  expect(JSON.stringify(listed.body)).not.toContain(rot2.body.apiKey);
  await request(srv).post(`/api/console/api-keys/${keyRow.id}/reveal`).set(auth).send({}).expect(400);
  const kp3 = await request(srv).post('/api/console/api-keys/phone/start').set(auth).set('Origin', 'https://ars2fa.baro.me').expect(201);
  await completePcCall(kp3.body.session_id, '01000000000', 'key.3');
  const seen = await request(srv).post(`/api/console/api-keys/${keyRow.id}/reveal`).set(auth).send({ phoneSessionId: kp3.body.session_id }).expect(201);
  expect(seen.body.apiKey).toBe(rot2.body.apiKey);
  await request(srv).post(`/api/console/api-keys/${keyRow.id}/reveal`).set(auth).send({ phoneSessionId: kp3.body.session_id }).expect(400); // one use
  expect(seen.body).toMatchObject({ replaced: false, viewsLeft: 2 });
  // views 2 and 3 show the same key; the 4th issues a new key and the old one stops
  for (const [i, left] of [[4, 1], [5, 0]] as const) {
    const kp = await request(srv).post('/api/console/api-keys/phone/start').set(auth).set('Origin', 'https://ars2fa.baro.me').expect(201);
    await completePcCall(kp.body.session_id, '01000000000', `key.${i}`);
    const v = await request(srv).post(`/api/console/api-keys/${keyRow.id}/reveal`).set(auth).send({ phoneSessionId: kp.body.session_id }).expect(201);
    expect(v.body).toMatchObject({ apiKey: rot2.body.apiKey, replaced: false, viewsLeft: left });
  }
  const kp6 = await request(srv).post('/api/console/api-keys/phone/start').set(auth).set('Origin', 'https://ars2fa.baro.me').expect(201);
  await completePcCall(kp6.body.session_id, '01000000000', 'key.6');
  const fourth = await request(srv).post(`/api/console/api-keys/${keyRow.id}/reveal`).set(auth).send({ phoneSessionId: kp6.body.session_id }).expect(201);
  expect(fourth.body).toMatchObject({ replaced: true, viewsLeft: 3 });
  expect(fourth.body.apiKey).not.toBe(rot2.body.apiKey);
  await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${rot2.body.apiKey}`).send(id).expect(401);

  const mine = await request(srv).get('/api/console/sessions').set(auth).expect(200);
  expect(mine.body).toHaveLength(2);
  expect(JSON.stringify(mine.body)).not.toMatch(/callerPhoneEnc|pcCode|dialToken/);
  // other customers' resources are not reachable
  await request(srv).patch(`/api/console/apps/does-not-exist/settings`).set(auth).send({ confirmKeyRequired: true }).expect(404);
});
test('web widget: registered origin only, popup flow, one-time server verification', async () => {
  const srv = app.getHttpServer();
  await app.get(NumberPoolService).importInventory(numbers(10), LINES);
  const c = await seedClient(prisma);
  const web = await prisma.applicationApp.create({ data: { applicationId: c.app.applicationId, mobileAppName: 'Shop', platform: 'WEB', status: 'APPROVED',
    integrityPolicy: 'OFF', allowedOrigins: 'https://shop.example.com', siteKey: 'pk_testsitekey0123456789' } });
  const body = { site_key: web.siteKey, country_code: '82', phone: '010-9711-1104', purpose: '문의하기' };
  await request(srv).post('/v1/widget/sessions').send(body).expect(403);                                   // no Origin
  await request(srv).post('/v1/widget/sessions').set('Origin', 'https://evil.example').send(body).expect(403);
  await request(srv).post('/v1/widget/sessions').set('Origin', 'https://shop.example.com').send({ ...body, site_key: 'pk_unknownkey0123456789' }).expect(401);
  const pre = await request(srv).options('/v1/widget/sessions').set('Origin', 'https://shop.example.com').set('Access-Control-Request-Method', 'POST');
  expect(pre.headers['access-control-allow-origin']).toBe('https://shop.example.com');
  const started = await request(srv).post('/v1/widget/sessions').set('Origin', 'https://shop.example.com').send(body).expect(200);
  expect(started.body.popup_url).toMatch(/\/w\/pc\/[A-Za-z0-9_-]{24}$/);
  expect(started.body).not.toHaveProperty('dial_number');
  const token = String(started.body.popup_url).split('/').pop();
  let pop = await request(srv).get(`/api/public/ars/widget/${token}`).expect(200);
  expect(pop.body).toMatchObject({ state: 'PENDING', origin: 'https://shop.example.com' });
  expect(pop.body.dial_page_url).toMatch(/\/m\/ars\//);
  expect(pop.body.pc_code).toBeUndefined();

  const s = await prisma.arsSession.findUniqueOrThrow({ where: { sessionId: started.body.session_id } });
  expect(s.mode).toBe('PC');
  await request(srv).post('/internal/authlog').set('X-Internal-Key', KEY).send({ vn: s.vn, an: '01097111104', callStartTime: kst(new Date()), callId: '999' }).expect(200);
  const con = await request(srv).post('/internal/pbx/connect').type('form').send({ rn: s.rn, caller: '01097111104', uid: 'w.1', t0: String(Math.floor(Date.now() / 1000)), key: KEY }).expect(200);
  expect(con.text).toMatch(/^PC:4:/);
  pop = await request(srv).get(`/api/public/ars/widget/${token}`).expect(200);
  expect(pop.body.state).toBe('CALL_CONFIRMED');
  expect(pop.body.dial_page_url).toBeUndefined();
  const code = await request(srv).post('/internal/pbx/code').type('form').send({ uid: 'w.1', code: pop.body.pc_code, key: KEY }).expect(200);
  expect(code.text).toBe('OK');
  pop = await request(srv).get(`/api/public/ars/widget/${token}`).expect(200);
  expect(pop.body).toMatchObject({ state: 'VERIFIED', phone_masked: '010****1104' });

  await request(srv).post('/v1/widget/verify').set('Authorization', 'Bearer wrong-key').send({ session_id: s.sessionId }).expect(401);
  const v1 = await request(srv).post('/v1/widget/verify').set('Authorization', `Bearer ${c.key}`).send({ session_id: s.sessionId, consume: true }).expect(200);
  expect(v1.body).toMatchObject({ verified: true, phone: '01097111104', origin: 'https://shop.example.com' });
  const v2 = await request(srv).post('/v1/widget/verify').set('Authorization', `Bearer ${c.key}`).send({ session_id: s.sessionId, consume: true }).expect(200);
  expect(v2.body).toMatchObject({ verified: false, reason: 'already_used' });
  // another customer's key cannot read it
  const other = await seedClient(prisma);
  await request(srv).post('/v1/widget/verify').set('Authorization', `Bearer ${other.key}`).send({ session_id: s.sessionId }).expect(404);
});
/** Runs the PBX side of a PC-mode call for a session: AuthLog -> connect -> code shown -> keyed in. */
async function completePcCall(sessionId: string, phone: string, uid: string, rightCode = true) {
  const srv = app.getHttpServer();
  const s = await prisma.arsSession.findUniqueOrThrow({ where: { sessionId } });
  await request(srv).post('/internal/authlog').set('X-Internal-Key', KEY).send({ vn: s.vn, an: phone, callStartTime: kst(new Date()), callId: `c-${uid}` }).expect(200);
  await request(srv).post('/internal/pbx/connect').type('form').send({ rn: s.rn, caller: phone, uid, t0: String(Math.floor(Date.now() / 1000)), key: KEY }).expect(200);
  const code = (await prisma.arsSession.findUniqueOrThrow({ where: { sessionId } })).pcCode!;
  await request(srv).post('/internal/pbx/code').type('form').send({ uid, code: rightCode ? code : '0000', key: KEY }).expect(200);
}

test('sign-up with ARS phone check: verified, same phone, one use', async () => {
  const srv = app.getHttpServer();
  await app.get(NumberPoolService).importInventory(numbers(10), LINES);
  process.env.SIGNUP_PHONE_VERIFY = 'on';
  try {
    expect((await request(srv).get('/api/auth/config').expect(200)).body.phoneVerify).toBe(true);
    const st = await request(srv).post('/api/auth/phone/start').set('Origin', 'https://ars2fa.baro.me').send({ countryCode: '82', phone: '01097111104' }).expect(200);
    expect(st.body.popup_url).toMatch(/\/w\/pc\//);
    const base = { password: 'Abcd123!', companyName: 'Co', contactName: 'N' };
    // not verified yet
    await request(srv).post('/api/auth/signup').send({ ...base, email: `a${Date.now()}@ex.com`, contactPhone: '01097111104', phoneSessionId: st.body.session_id }).expect(400);
    await completePcCall(st.body.session_id, '01097111104', 'su.1');
    // other phone than the verified one
    await request(srv).post('/api/auth/signup').send({ ...base, email: `b${Date.now()}@ex.com`, contactPhone: '01011112222', phoneSessionId: st.body.session_id }).expect(400);
    await request(srv).post('/api/auth/signup').send({ ...base, email: `c${Date.now()}@ex.com`, contactPhone: '010-9711-1104', phoneSessionId: st.body.session_id }).expect(201);
    // one use only
    await request(srv).post('/api/auth/signup').send({ ...base, email: `d${Date.now()}@ex.com`, contactPhone: '01097111104', phoneSessionId: st.body.session_id }).expect(400);
    // a session of another app cannot be used for sign-up
    await request(srv).post('/api/auth/signup').send({ ...base, email: `e${Date.now()}@ex.com`, contactPhone: '01097111104' }).expect(400);
  } finally {
    delete process.env.SIGNUP_PHONE_VERIFY;
  }
});

test('customer console live test: own approved app, popup, own verification', async () => {
  const srv = app.getHttpServer();
  await app.get(NumberPoolService).importInventory(numbers(10), LINES);
  const email = `t${Date.now()}@ex.com`;
  await request(srv).post('/api/auth/signup').send({ email, password: 'Abcd123!', companyName: 'Co', contactName: 'N', contactPhone: '01000000000' }).expect(201);
  const auth = { Authorization: `Bearer ${(await request(srv).post('/api/auth/login').send({ email, password: 'Abcd123!' })).body.accessToken}` };
  expect((await request(srv).get('/api/console/test/apps').set(auth).expect(200)).body).toEqual([]);
  // the console form now sends only the service name, app name and platform
  await request(srv).post('/api/applications').set(auth).send({ serviceName: 'Slim', apps: [{ mobileAppName: 'Slim', platform: 'ANDROID' }] }).expect(400); // package name required
  await request(srv).post('/api/applications').set(auth).send({ serviceName: 'Slim', apps: [{ mobileAppName: 'Slim', platform: 'IOS', bundleId: 'bad id' }] }).expect(400);
  const slim = await request(srv).post('/api/applications').set(auth).send({ serviceName: 'Slim', apps: [{ mobileAppName: 'Slim', platform: 'ANDROID', packageName: 'com.slim.app' }] }).expect(201);
  expect(slim.body).toMatchObject({ usagePurpose: '', expectedMonthlyRequests: 0 });
  await prisma.apiApplication.delete({ where: { id: slim.body.id } }).catch(() => undefined);
  const created = await request(srv).post('/api/applications').set(auth).send({ serviceName: 'Svc', usagePurpose: 'x', expectedMonthlyRequests: 100, apps: [{ mobileAppName: 'A', platform: 'ANDROID', packageName: 'a.b' }] }).expect(201);
  await prisma.apiApplication.update({ where: { id: created.body.id }, data: { status: 'APPROVED' } });
  await prisma.applicationApp.updateMany({ where: { applicationId: created.body.id }, data: { status: 'APPROVED' } });
  await prisma.apiKey.create({ data: { applicationId: created.body.id, keyPrefix: 'x', keyHash: 'k-' + Date.now(), status: 'ACTIVE', monthlyLimit: 100 } });
  const apps = (await request(srv).get('/api/console/test/apps').set(auth).expect(200)).body;
  expect(apps).toHaveLength(1);
  const st = await request(srv).post('/api/console/test/popup').set(auth).set('Origin', 'https://ars2fa.baro.me').send({ appId: apps[0].id, country_code: '82', expected_phone: '01097111104' }).expect(201);
  await completePcCall(st.body.session_id, '01097111104', 'ct.1');
  const v = await request(srv).post('/api/console/test/verify').set(auth).send({ session_id: st.body.session_id }).expect(201);
  expect(v.body).toMatchObject({ verified: true, phone: '01097111104' });
  expect((await request(srv).get('/api/console/sessions').set(auth).expect(200)).body).toHaveLength(1);
});
test('customer ARS settings apply to new sessions; client info of browser and phone is collected', async () => {
  const srv = app.getHttpServer();
  await app.get(NumberPoolService).importInventory(numbers(10), LINES);
  const email = `cs${Date.now()}@ex.com`;
  await request(srv).post('/api/auth/signup').send({ email, password: 'Abcd123!', companyName: 'Co', contactName: 'N', contactPhone: '01000000000' }).expect(201);
  const auth = { Authorization: `Bearer ${(await request(srv).post('/api/auth/login').send({ email, password: 'Abcd123!' })).body.accessToken}` };
  await request(srv).patch('/api/console/ars-settings').set(auth).send({ pcCodeSeconds: 5 }).expect(400);          // below the customer range
  await request(srv).patch('/api/console/ars-settings').set(auth).send({ cooldownSeconds: 5 }).expect(400);        // not a customer setting
  const set = await request(srv).patch('/api/console/ars-settings').set(auth).send({ pcCodeSeconds: 30, pcCodeDigits: 6, leaseSecondsPc: 60 }).expect(200);
  expect(set.body.effective).toMatchObject({ pcCodeSeconds: 30, pcCodeDigits: 6, leaseSecondsPc: 60 });
  const created = await request(srv).post('/api/applications').set(auth).send({ serviceName: 'S', usagePurpose: 'x', expectedMonthlyRequests: 100, apps: [{ mobileAppName: 'A', platform: 'ANDROID', packageName: 'a.b' }] }).expect(201);
  await prisma.apiApplication.update({ where: { id: created.body.id }, data: { status: 'APPROVED' } });
  await prisma.applicationApp.updateMany({ where: { applicationId: created.body.id }, data: { status: 'APPROVED' } });
  await prisma.apiKey.create({ data: { applicationId: created.body.id, keyPrefix: 'x', keyHash: 'k2-' + Date.now(), status: 'ACTIVE', monthlyLimit: 100 } });
  const appId = (await request(srv).get('/api/console/test/apps').set(auth)).body[0].id;
  const pcUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const st = await request(srv).post('/api/console/test/popup').set(auth).set('User-Agent', pcUa).set('Origin', 'https://ars2fa.baro.me')
    .send({ appId, country_code: '82', expected_phone: '01097111104' }).expect(201);
  let s = await prisma.arsSession.findUniqueOrThrow({ where: { sessionId: st.body.session_id } });
  expect(s.pcCodeSeconds).toBe(30);
  expect(s.pcCode).toMatch(/^[0-9]{6}$/);
  expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBeGreaterThan(55_000);
  expect(s.pcClient).toMatchObject({ browser: 'Chrome 141', os: 'Windows 10/11', device: 'Windows PC' });
  // the phone opens the QR page
  const phoneUa = 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
  await request(srv).get(`/api/public/ars/dial/${s.dialToken}`).set('User-Agent', phoneUa).expect(200);
  await request(srv).post(`/api/public/ars/dial/${s.dialToken}/device`).set('User-Agent', phoneUa).send({ screen: '412x915', tz: 'Asia/Seoul' }).expect(204);
  s = await prisma.arsSession.findUniqueOrThrow({ where: { sessionId: st.body.session_id } });
  expect(s.mobileClient).toMatchObject({ device: 'Samsung SM-S918N', browser: '삼성 인터넷 25', os: 'Android 14', screen: '412x915', tz: 'Asia/Seoul', deviceType: 'mobile' });
  // PBX sees the customer's code length and time
  await request(srv).post('/internal/authlog').set('X-Internal-Key', KEY).send({ vn: s.vn, an: '01097111104', callStartTime: kst(new Date()), callId: 'cs1' }).expect(200);
  const con = await request(srv).post('/internal/pbx/connect').type('form').send({ rn: s.rn, caller: '01097111104', uid: 'cs.1', t0: String(Math.floor(Date.now() / 1000)), key: KEY }).expect(200);
  expect(con.text).toBe('PC:6:26');
  await request(srv).post('/internal/pbx/code').type('form').send({ uid: 'cs.1', code: s.pcCode, key: KEY }).expect(200);
  const v = await request(srv).post('/api/console/test/verify').set(auth).send({ session_id: s.sessionId }).expect(201);
  expect(v.body.clients.phone).toMatchObject({ device: 'Samsung SM-S918N' });
  expect(v.body.clients.requester).not.toHaveProperty('ua');
});
test('internal endpoints require the internal key', async () => {
  await request(app.getHttpServer()).post('/internal/authlog').send({ vn: '050700952000', callStartTime: '2026-10-21 10:00:00', callId: '1' }).expect(403);
  await request(app.getHttpServer()).post('/internal/pbx/verify').set('X-Internal-Key', 'x'.repeat(40)).send({ rn: LINES[0], uid: 'u' }).expect(403);
});

test('API errors: bad key 401, unknown app 403, validation 400', async () => {
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ api_key: 'nope', mobile_app_name: 'X', client_platform: 'ANDROID' }).expect(401);
  const c = await seedClient(prisma);
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ api_key: c.key, mobile_app_name: 'Other', client_platform: 'ANDROID' }).expect(403);
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'WEB' }).expect(403); // web sites use the widget, not the app API
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'DESKTOP' }).expect(400);
  await request(app.getHttpServer()).post('/v1/ars/sessions/status').send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'ANDROID', package_name: c.identity.package_name, session_id: 'nope' }).expect(400);
});

test('no number available -> 503', async () => {
  const c = await seedClient(prisma);
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ ...c.identity }).expect(503);
});

test('auto approval 10 minutes after submission; a package name of another customer waits for an admin; no monthly limit', async () => {
  const srv = app.getHttpServer();
  const mk = async (tag: string) => {
    const email = `auto${tag}${Date.now()}@ex.com`;
    await request(srv).post('/api/auth/signup').send({ email, password: 'Abcd123!', companyName: 'Co', contactName: 'N', contactPhone: '01000000000' }).expect(201);
    const login = await request(srv).post('/api/auth/login').send({ email, password: 'Abcd123!' }).expect(201);
    return { Authorization: `Bearer ${login.body.accessToken}` };
  };
  const pkg = `com.auto.t${Date.now()}`;
  const a1 = await mk('a');
  const first = await request(srv).post('/api/applications').set(a1).send({ serviceName: 'Auto1', apps: [{ mobileAppName: 'Auto1', platform: 'ANDROID', packageName: pkg }] }).expect(201);
  await request(srv).post(`/api/applications/${first.body.id}/submit`).set(a1).expect(201);
  const a2 = await mk('b');
  const dup = await request(srv).post('/api/applications').set(a2).send({ serviceName: 'Auto2', apps: [{ mobileAppName: 'Auto2', platform: 'ANDROID', packageName: pkg }] }).expect(201);
  await request(srv).post(`/api/applications/${dup.body.id}/submit`).set(a2).expect(201);
  const svc = app.get(AutoApproveService);
  await svc.tick(); // not 10 minutes yet
  expect((await prisma.apiApplication.findUniqueOrThrow({ where: { id: first.body.id } })).status).toBe('SUBMITTED');
  const old = new Date(Date.now() - 11 * 60_000);
  await prisma.apiApplication.updateMany({ where: { id: { in: [first.body.id, dup.body.id] } }, data: { submittedAt: old } });
  await svc.tick();
  const ok = await prisma.apiApplication.findUniqueOrThrow({ where: { id: first.body.id }, include: { apiKeys: true, reviewHistories: true } });
  expect(ok.status).toBe('APPROVED');
  expect(ok.apiKeys[0].monthlyLimit).toBe(0);
  expect(ok.reviewHistories[0]).toMatchObject({ adminUserId: null, toStatus: 'APPROVED' });
  // first view of the new key: no ARS check; the next one needs it
  const fv = await request(srv).post(`/api/console/api-keys/${ok.apiKeys[0].id}/reveal`).set(a1).send({}).expect(201);
  expect(fv.body).toMatchObject({ firstView: true, viewsLeft: 3 });
  expect(fv.body.apiKey).toMatch(/^ars2fa_[A-Za-z0-9_-]{43}$/);
  await request(srv).post(`/api/console/api-keys/${ok.apiKeys[0].id}/reveal`).set(a1).send({}).expect(400);
  const waiting = await prisma.apiApplication.findUniqueOrThrow({ where: { id: dup.body.id } });
  expect(waiting.status).toBe('SUBMITTED');
  expect(waiting.adminComment).toContain('자동 승인 보류');
});
