import { Module } from '@nestjs/common';
import { ApiApplicationsModule } from '../api-applications/api-applications.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [ApiApplicationsModule, ApiKeysModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
