import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../common/auth.guard';
import { ApiKeysService } from './api-keys.service';

@ApiTags('api-keys')
@UseGuards(JwtAuthGuard)
@Controller('api/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.apiKeysService.listForUser(request.user!.id);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.apiKeysService.getForUser(request.user!.id, id);
  }
}
