import { Module } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, RedisService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
