import { BadRequestException } from '@nestjs/common';
import { TurnstileService } from '../src/modules/auth/turnstile.service';

describe('Turnstile (sign-up bot protection)', () => {
  const svc = new TurnstileService();
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.restoreAllMocks(); });

  test('off when no secret is configured', async () => {
    delete process.env.TURNSTILE_SECRET;
    await expect(svc.verify(undefined)).resolves.toBeUndefined();
    expect(svc.siteKey).toBeNull();
  });

  test('requires a token and accepts only a successful verdict for our hostname', async () => {
    process.env.TURNSTILE_SECRET = 'test-secret';
    process.env.TURNSTILE_SITE_KEY = '0x4SITE';
    expect(svc.siteKey).toBe('0x4SITE');
    await expect(svc.verify(undefined)).rejects.toBeInstanceOf(BadRequestException);
    const reply = (j: unknown) => jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify(j), { status: 200 }));
    reply({ success: true, hostname: 'ars2fa.baro.me' });
    await expect(svc.verify('tok', '1.2.3.4')).resolves.toBeUndefined();
    const body = new URLSearchParams(String(((global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit])[1].body));
    expect(Object.fromEntries(body)).toEqual({ secret: 'test-secret', response: 'tok', remoteip: '1.2.3.4' });
    jest.restoreAllMocks();
    reply({ success: true, hostname: 'evil.example' });
    await expect(svc.verify('tok')).rejects.toBeInstanceOf(BadRequestException);
    jest.restoreAllMocks();
    reply({ success: false, 'error-codes': ['invalid-input-response'] });
    await expect(svc.verify('tok')).rejects.toBeInstanceOf(BadRequestException);
  });
});
