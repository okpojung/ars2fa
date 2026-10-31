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
