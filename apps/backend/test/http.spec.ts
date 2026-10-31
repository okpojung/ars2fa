import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
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
test('internal endpoints require the internal key', async () => {
  await request(app.getHttpServer()).post('/internal/authlog').send({ vn: '050700952000', callStartTime: '2026-10-21 10:00:00', callId: '1' }).expect(403);
  await request(app.getHttpServer()).post('/internal/pbx/verify').set('X-Internal-Key', 'x'.repeat(40)).send({ rn: LINES[0], uid: 'u' }).expect(403);
});

test('API errors: bad key 401, unknown app 403, validation 400', async () => {
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ api_key: 'nope', mobile_app_name: 'X', client_platform: 'ANDROID' }).expect(401);
  const c = await seedClient(prisma);
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ api_key: c.key, mobile_app_name: 'Other', client_platform: 'ANDROID' }).expect(403);
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'WEB' }).expect(400);
  await request(app.getHttpServer()).post('/v1/ars/sessions/status').send({ api_key: c.key, mobile_app_name: 'BS Point', client_platform: 'ANDROID', package_name: c.identity.package_name, session_id: 'nope' }).expect(400);
});

test('no number available -> 503', async () => {
  const c = await seedClient(prisma);
  await request(app.getHttpServer()).post('/v1/ars/sessions').send({ ...c.identity }).expect(503);
});
