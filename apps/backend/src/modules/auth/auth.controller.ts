import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/auth.guard';
import { AuthService } from './auth.service';
import { TurnstileService } from './turnstile.service';
import { getClientIp } from '../../common/request.util';
import { LoginDto, SignupDto, SignupPhoneStartDto } from './auth.dto';
import { WidgetService } from '../ars-engine/widget.service';

@ApiTags('auth')
@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly turnstile: TurnstileService, private readonly widget: WidgetService) {}

  private phoneCheckOn() {
    return process.env.SIGNUP_PHONE_VERIFY === 'on';
  }

  /** Public settings for the sign-up page (Turnstile site key, null when bot protection is off). */
  @Get('auth/config')
  config() {
    return { turnstileSiteKey: this.turnstile.siteKey, phoneVerify: this.phoneCheckOn() };
  }

  @Post('auth/signup')
  async signup(@Body() dto: SignupDto, @Req() req: Request) {
    if (this.phoneCheckOn()) {
      // bot check already happened when the phone check started; the verified phone must be the contact phone
      dto.contactPhone = await this.widget.consumeSignupPhone(dto.phoneSessionId, dto.contactPhone);
    } else {
      await this.turnstile.verify(dto.turnstileToken, getClientIp(req));
    }
    return this.authService.signup(dto);
  }

  /** Sign-up: starts the ARS phone check of the contact phone (popup). Needs a passed Turnstile check. */
  @Post('auth/phone/start')
  @HttpCode(200)
  async phoneStart(@Body() dto: SignupPhoneStartDto, @Req() req: Request) {
    await this.turnstile.verify(dto.turnstileToken, getClientIp(req));
    const client = await this.widget.systemClient('ARS2FA-SIGNUP', 'WEB', 'ARS2FA 회원가입');
    return this.widget.startForClient(client, { origin: this.widget.ownOrigin(req.header('origin')), ip: getClientIp(req),
      phone: dto.phone, countryCode: dto.countryCode, purpose: '회원가입' });
  }

  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('admin/auth/login')
  adminLogin(@Body() dto: LoginDto) {
    return this.authService.adminLogin(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return { principal: request.user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/me')
  adminMe(@Req() request: AuthenticatedRequest) {
    return { principal: request.user };
  }

  @Post('auth/logout')
  logout(@Req() _request: Request) {
    return { ok: true };
  }
}
