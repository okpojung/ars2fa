import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AdminModule } from './modules/admin/admin.module';
import { ApiApplicationsModule } from './modules/api-applications/api-applications.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ArsGatewayModule } from './modules/ars-gateway/ars-gateway.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthRequestsModule } from './modules/auth-requests/auth-requests.module';
import { HealthModule } from './modules/health/health.module';
import { StatisticsModule } from './modules/statistics/statistics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ApiApplicationsModule,
    ApiKeysModule,
    AdminModule,
    ArsGatewayModule,
    AuthRequestsModule,
    StatisticsModule,
    HealthModule,
  ],
})
export class AppModule {}
