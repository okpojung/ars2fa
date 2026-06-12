import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../common/auth.guard';
import {
  CreateApplicationDto,
  UpdateApplicationDto,
} from './api-applications.dto';
import { ApiApplicationsService } from './api-applications.service';

@ApiTags('api-applications')
@UseGuards(JwtAuthGuard)
@Controller('api/applications')
export class ApiApplicationsController {
  constructor(private readonly applicationsService: ApiApplicationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.applicationsService.list(request.user!.id);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.applicationsService.create(request.user!.id, dto);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.applicationsService.getOwned(request.user!.id, id);
  }

  @Patch(':id')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.applicationsService.update(request.user!.id, id, dto);
  }

  @Post(':id/submit')
  submit(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.applicationsService.submit(request.user!.id, id);
  }
}
