import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../common/auth.guard';
import { StatisticsService } from './statistics.service';

@ApiTags('statistics')
@UseGuards(JwtAuthGuard)
@Controller('api/statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  summary(@Req() request: AuthenticatedRequest) {
    return this.statisticsService.summary(request.user!);
  }
}
