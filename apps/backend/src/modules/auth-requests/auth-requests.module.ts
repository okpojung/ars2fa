import { Module } from '@nestjs/common';
import { AuthRequestsController } from './auth-requests.controller';
import { AuthRequestsService } from './auth-requests.service';

@Module({
  controllers: [AuthRequestsController],
  providers: [AuthRequestsService],
  exports: [AuthRequestsService],
})
export class AuthRequestsModule {}
