import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { RedisService } from '../../common/redis.service';
import { getClientIp } from '../../common/request.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from './mail.service';
import { WidgetService } from './widget.service';

export class EmailCheckDto {
  @IsString() @MaxLength(254) email!: string;
}

export class FormTestSendDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(5) @MaxLength(2000) message!: string;
  @IsString() @Matches(/^ars_[A-Za-z0-9_-]{10,40}$/) session_id!: string;
}

const APP_NAME = 'ARS2FA-FORMTEST';

/**
 * Public test page /form_test: a contact form that needs an email (format + domain check) and a phone verified
 * through the web widget; the server confirms the verification (one use) before it sends the mail.
 */
@ApiTags('form-test')
@Controller('api/public/form-test')
export class FormTestController {
  constructor(private readonly widget: WidgetService, private readonly mail: MailService, private readonly prisma: PrismaService,
    private readonly redis: RedisService) {}

  private async client() {
    const c = await this.widget.systemClient(APP_NAME, 'WEB', 'ARS2FA 문의 폼 시험');
    if (!c.app.siteKey || !c.app.allowedOrigins) {
      const origins = ['https://ars2fa.baro.me', 'https://192.168.94.180:9446'].join(',');
      c.app = await this.prisma.applicationApp.update({ where: { id: c.app.id }, data: { allowedOrigins: origins, siteKey: c.app.siteKey ?? `pk_${randomBytes(18).toString('base64url')}` } });
    }
    return c;
  }

  private async limit(req: Request, kind: string, max: number, windowSec: number) {
    const ip = getClientIp(req) ?? 'unknown';
    const n = await this.redis.incrementWithTtl(`formtest:${kind}:${ip}:${Math.floor(Date.now() / (windowSec * 1000))}`, windowSec * 2);
    if (n > max) throw new HttpException({ code: 'TOO_MANY_REQUESTS', message: '잠시 후 다시 시도해 주세요.' }, 429);
  }

  @Get('config')
  async config() {
    const c = await this.client();
    return { siteKey: c.app.siteKey, mailEnabled: this.mail.enabled };
  }

  /** Format + the domain receives mail (MX, or an address record). */
  @Post('check-email')
  @HttpCode(200)
  async checkEmail(@Body() dto: EmailCheckDto, @Req() req: Request) {
    await this.limit(req, 'email', 40, 600);
    return this.mail.check(dto.email);
  }

  @Post('send')
  @HttpCode(200)
  async send(@Body() dto: FormTestSendDto, @Req() req: Request) {
    await this.limit(req, 'send', 10, 3600);
    const email = dto.email.trim();
    const ec = await this.mail.check(email);
    if (!ec.ok) throw new BadRequestException({ code: 'EMAIL_INVALID', reason: ec.reason, message: '이메일 주소를 확인해 주세요.' });
    const c = await this.client();
    const s = await this.prisma.arsSession.findUnique({ where: { sessionId: dto.session_id }, select: { id: true, applicationAppId: true } });
    if (!s || s.applicationAppId !== c.app.id) throw new BadRequestException({ code: 'PHONE_NOT_VERIFIED', message: '휴대폰 인증을 해 주세요.' });
    // the server-side check every customer site does: verified, and used only once
    const v = await this.widget.verifyForKey(c.apiKeyId, dto.session_id, true);
    if (!v.verified) throw new BadRequestException({ code: 'PHONE_NOT_VERIFIED', reason: v.reason, message: v.reason === 'already_used' ? '이미 사용한 인증입니다. 다시 인증해 주세요.' : '휴대폰 인증을 해 주세요.' });

    const name = dto.name.replace(/[\r\n]+/g, ' ').trim();
    const when = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
    const ip = getClientIp(req) ?? '-';
    const body = [
      `[ARS2FA 문의 폼 시험] ${when}`, '',
      `이름: ${name}`, `이메일: ${email}`, `휴대폰(ARS 인증): ${v.phone ?? v.phone_masked}`, `인증 번호: ${v.session_id}`,
      `요청 IP: ${ip}`, `PC/브라우저: ${fmtClient(v.clients?.requester)}`, `휴대폰 기기: ${fmtClient(v.clients?.phone)}`, '',
      '문의 내용:', dto.message.trim(),
    ].join('\n');
    if (!this.mail.enabled) return { sent: false, mail: 'disabled', phone_masked: v.phone_masked, session_id: v.session_id };
    const operator = process.env.FORM_TEST_MAIL_TO || 'ok@baro.pro';
    try {
      await this.mail.send({ to: operator, replyTo: email, subject: `[ARS2FA 문의 시험] ${name}`, text: body });
      // copy to the sender (shows on the phone that the whole flow worked)
      await this.mail.send({ to: email, subject: '[ARS2FA] 문의가 접수되었습니다 (시험)', text: `${name}님, 아래 내용으로 문의가 접수되었습니다.\n\n${dto.message.trim()}\n\n휴대폰 인증: ${v.phone_masked}\n접수 시각: ${when}\n\n이 메일은 ARS2FA 문의 폼 시험(https://ars2fa.baro.me/form_test)에서 보낸 것입니다.` });
    } catch {
      // let the same verification be used again after a mail failure
      await this.prisma.arsSession.update({ where: { id: s.id }, data: { widgetConsumedAt: null } });
      throw new HttpException({ code: 'MAIL_FAILED', message: '메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
    }
    return { sent: true, mail: 'sent', phone_masked: v.phone_masked, session_id: v.session_id, to: [maskEmail(operator), maskEmail(email)] };
  }
}

function fmtClient(c: unknown) {
  const x = (c ?? {}) as Record<string, unknown>;
  return [x.device, x.os, x.browser].filter(Boolean).join(' / ') || '-';
}

function maskEmail(e: string) {
  const [l, d] = e.split('@');
  return `${l.slice(0, 2)}${'*'.repeat(Math.max(1, l.length - 2))}@${d}`;
}
