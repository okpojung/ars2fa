import { Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { ApiKeyAuthService } from './api-key-auth.service';
import { ArsAdminController, ArsApiController, ArsInternalController } from './ars-engine.controller';
import { ArsSessionService } from './ars-session.service';
import { ArsSettingsService } from './ars-settings.service';
import { IntegrityService } from './integrity/integrity.service';
import { NumberPoolService } from './number-pool.service';

/** Expires overdue sessions every few seconds (releases their numbers into cooldown). */
@Injectable()
export class ArsSweeper implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly sessions: ArsSessionService) {}
  onModuleInit() {
    if (process.env.ARS_SWEEPER === 'off') return;
    this.timer = setInterval(() => { this.sessions.expireDue().catch(() => undefined); }, 5000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Module({
  controllers: [ArsApiController, ArsInternalController, ArsAdminController],
  providers: [ArsSessionService, NumberPoolService, ArsSettingsService, IntegrityService, ApiKeyAuthService, RedisService, ArsSweeper],
  exports: [ArsSessionService, NumberPoolService],
})
export class ArsEngineModule {}
