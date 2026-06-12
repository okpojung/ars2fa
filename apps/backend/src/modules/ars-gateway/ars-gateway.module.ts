import { Module } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { ArsGatewayController } from './ars-gateway.controller';
import { ArsGatewayService } from './ars-gateway.service';
import { LegacyArsService } from './legacy-ars.service';

@Module({
  controllers: [ArsGatewayController],
  providers: [ArsGatewayService, LegacyArsService, RedisService],
})
export class ArsGatewayModule {}
