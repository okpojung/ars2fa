import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { getClientIp } from '../../common/request.util';
import { WidgetService } from './widget.service';

export class WidgetStartDto {
  @IsString() @Matches(/^pk_[A-Za-z0-9_-]{16,64}$/) site_key!: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9]{1,4}$/) country_code?: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @MaxLength(40) purpose?: string;
}

export class WidgetVerifyDto {
  @IsString() @Matches(/^ars_[A-Za-z0-9_-]{10,40}$/) session_id!: string;
  /** true: mark the result used (one sign-up / form per verification) */
  @IsOptional() @IsBoolean() consume?: boolean;
  @IsOptional() @IsString() @MaxLength(200) api_key?: string;
}

/** Web widget API (widget.js from the browser; verify from the customer server). CORS: see main.ts. */
@ApiTags('widget')
@Controller()
export class WidgetController {
  constructor(private readonly widget: WidgetService) {}

  /** Browser (widget.js): starts a PC-mode authentication for the phone typed on the page. Origin must be registered. */
  @Post('v1/widget/sessions')
  @HttpCode(200)
  start(@Body() dto: WidgetStartDto, @Req() req: Request) {
    return this.widget.start({ siteKey: dto.site_key, origin: req.header('origin'), ip: getClientIp(req), countryCode: dto.country_code, phone: dto.phone, purpose: dto.purpose });
  }

  /** Customer server: confirms a widget result with the secret API key (Authorization: Bearer). */
  @Post('v1/widget/verify')
  @HttpCode(200)
  verify(@Body() dto: WidgetVerifyDto, @Req() req: Request) {
    const auth = req.header('authorization');
    const key = dto.api_key ?? (auth?.startsWith('Bearer ') ? auth.slice(7) : undefined);
    return this.widget.verify(key, dto.session_id, dto.consume === true);
  }

  /** Popup page state (public, one-time token). */
  @Get('api/public/ars/widget/:token')
  popup(@Param('token') token: string) {
    return this.widget.popup(token);
  }
}
