import { MailService } from '../src/modules/ars-engine/mail.service';

describe('form test email checks', () => {
  test('address format', () => {
    for (const ok of ['ok@baro.pro', 'a.b+c@mail.example.co.kr', 'x_y@sub.domain.com']) expect(MailService.formatOk(ok)).toBe(true);
    for (const bad of ['', 'ok', 'ok@', '@baro.pro', 'ok@baro', 'ok@@baro.pro', '.ok@baro.pro', 'ok.@baro.pro', 'o..k@baro.pro', 'ok@baro..pro', 'ok@-baro.pro', 'ok @baro.pro', 'ok@baro.p'])
      expect(MailService.formatOk(bad)).toBe(false);
  });
  test('format errors are reported without DNS; mail is off without SMTP settings', async () => {
    const m = new MailService();
    expect(await m.check('not-an-email')).toEqual({ ok: false, reason: 'format' });
    delete process.env.SMTP_HOST;
    expect(m.enabled).toBe(false);
    expect(await m.send({ to: 'a@b.co', subject: 's', text: 't' })).toBe(false);
  });
});
