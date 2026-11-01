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
  expect(con.text).toBe('PC:4:9');
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

  const rot = await request(srv).post(`/api/console/api-keys/${keyRow.id}/rotate`).set(auth).expect(201);
  expect(rot.body.apiKey).toBeTruthy();
  const id = { mobile_app_name: 'MyApp', client_platform: 'ANDROID', package_name: 'com.my.app' };
  await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${rot.body.apiKey}`).send(id).expect(201);

  // press-1 off for this app
  const set = await request(srv).patch(`/api/console/apps/${appRow.id}/settings`).set(auth).send({ confirmKeyRequired: false, displayName: '내 앱' }).expect(200);
  expect(set.body).toMatchObject({ confirmKeyRequired: false, displayName: '내 앱' });
  const s2 = await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${rot.body.apiKey}`).send(id).expect(201);
  expect(s2.body.display_name).toBe('내 앱');
  expect((await prisma.arsSession.findUniqueOrThrow({ where: { sessionId: s2.body.session_id } })).confirmKey).toBe(false);

  // rotating again invalidates the previous secret
  const rot2 = await request(srv).post(`/api/console/api-keys/${keyRow.id}/rotate`).set(auth).expect(201);
  await request(srv).post('/v1/ars/sessions').set('Authorization', `Bearer ${rot.body.apiKey}`).send(id).expect(401);
  expect(rot2.body.apiKey).not.toBe(rot.body.apiKey);

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
