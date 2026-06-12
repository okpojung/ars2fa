import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { getClientIp, getRequestId } from '../../common/request.util';
import { ArsGatewayService } from './ars-gateway.service';
import { ArsConfirmDto, ArsInstallDto, ArsRecheckDto } from './ars-gateway.dto';

@ApiTags('ars-gateway')
@Controller('v1/ars')
export class ArsGatewayController {
  constructor(private readonly arsGatewayService: ArsGatewayService) {}

  @Post('install')
  install(@Body() dto: ArsInstallDto, @Req() request: Request) {
    return this.arsGatewayService.install(dto, this.meta(request));
  }

  @Post('confirm')
  confirm(@Body() dto: ArsConfirmDto, @Req() request: Request) {
    return this.arsGatewayService.confirm(dto, this.meta(request));
  }

  @Post('recheck')
  recheck(@Body() dto: ArsRecheckDto, @Req() request: Request) {
    return this.arsGatewayService.recheck(dto, this.meta(request));
  }

  private meta(request: Request) {
    return {
      requestId: getRequestId(request),
      ipAddress: getClientIp(request),
      userAgent: request.header('user-agent'),
    };
  }
}
