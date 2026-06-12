import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../common/auth.guard';
import { Roles } from '../../common/roles.decorator';
import { RolesGuard } from '../../common/roles.guard';
import { ApiApplicationsService } from '../api-applications/api-applications.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { AdminCommentDto, UpdateApiKeyLimitsDto } from './admin.dto';
import { AdminService } from './admin.service';

@ApiTags('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly applicationsService: ApiApplicationsService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  @Roles('REVIEWER', 'SUPER_ADMIN')
  @Get('applications')
  listApplications(@Query('status') status?: ApplicationStatus) {
    return this.applicationsService.adminList(status);
  }

  @Roles('REVIEWER', 'SUPER_ADMIN')
  @Get('applications/:id')
  getApplication(@Param('id') id: string) {
    return this.applicationsService.adminGet(id);
  }

  @Roles('REVIEWER', 'SUPER_ADMIN')
  @Post('applications/:id/request-revision')
  requestRevision(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AdminCommentDto,
  ) {
    return this.adminService.requestRevision(id, request.user!.id, dto.comment);
  }

  @Roles('REVIEWER', 'SUPER_ADMIN')
  @Post('applications/:id/reject')
  reject(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AdminCommentDto,
  ) {
    return this.adminService.reject(id, request.user!.id, dto.comment);
  }

  @Roles('REVIEWER', 'KEY_MANAGER', 'SUPER_ADMIN')
  @Post('applications/:id/approve')
  approve(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AdminCommentDto,
  ) {
    return this.adminService.approve(id, request.user!.id, dto.comment);
  }

  @Roles('KEY_MANAGER', 'SUPER_ADMIN')
  @Get('api-keys')
  listApiKeys() {
    return this.apiKeysService.adminList();
  }

  @Roles('KEY_MANAGER', 'SUPER_ADMIN')
  @Post('api-keys/:id/suspend')
  suspendKey(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.changeStatus(id, 'SUSPENDED', request.user!.id);
  }

  @Roles('KEY_MANAGER', 'SUPER_ADMIN')
  @Post('api-keys/:id/revoke')
  revokeKey(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.changeStatus(id, 'REVOKED', request.user!.id);
  }

  @Roles('KEY_MANAGER', 'SUPER_ADMIN')
  @Patch('api-keys/:id/limits')
  updateLimits(@Param('id') id: string, @Body() dto: UpdateApiKeyLimitsDto) {
    return this.apiKeysService.updateLimits(id, dto);
  }

  @Roles('OPERATOR', 'SUPER_ADMIN')
  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Roles('SUPER_ADMIN')
  @Get('audit-logs')
  auditLogs() {
    return this.adminService.listAuditLogs();
  }
}
