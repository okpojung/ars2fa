import { Module } from '@nestjs/common';
import { ApiApplicationsController } from './api-applications.controller';
import { ApiApplicationsService } from './api-applications.service';

@Module({
  controllers: [ApiApplicationsController],
  providers: [ApiApplicationsService],
  exports: [ApiApplicationsService],
})
export class ApiApplicationsModule {}
