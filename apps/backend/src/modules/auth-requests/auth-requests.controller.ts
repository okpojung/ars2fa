import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthRequestStatus } from '@prisma/client';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../common/auth.guard';
import { AuthRequestsService } from './auth-requests.service';

@ApiTags('auth-requests')
@UseGuards(JwtAuthGuard)
@Controller('api/auth-requests')
export class AuthRequestsController {
  constructor(private readonly authRequestsService: AuthRequestsService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('status') status?: AuthRequestStatus,
    @Query('apiKeyId') apiKeyId?: string,
  ) {
    return this.authRequestsService.listForUser(request.user!, {
      status,
      apiKeyId,
    });
  }

  @Get(':requestId')
  get(@Req() request: AuthenticatedRequest, @Param('requestId') requestId: string) {
    return this.authRequestsService.getForUser(request.user!, requestId);
  }
}
