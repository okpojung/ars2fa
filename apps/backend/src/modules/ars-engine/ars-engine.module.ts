import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { ApiKeyAuthService } from './api-key-auth.service';
import { ArsAdminController, ArsApiController, ArsInternalController, ArsPublicController } from './ars-engine.controller';
import { ArsSessionService } from './ars-session.service';
import { ArsSettingsService } from './ars-settings.service';
import { CarrierService } from './carrier.service';
import { CustomerConsoleController } from './customer-console.controller';
import { IntegrityService } from './integrity/integrity.service';
import { NumberPoolService } from './number-pool.service';

/**
 * Every 2 s: expires overdue sessions (numbers go into cooldown) and switches off CallMix forwarding that is due.
 * Runs one pass at a time.
 */
@Injectable()
export class ArsSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ArsSweeper');
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly sessions: ArsSessionService, private readonly pool: NumberPoolService, private readonly carrier: CarrierService) {}

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.sessions.expireDue();
      await this.pool.unlinkDue(this.carrier);
    } catch (e) {
      this.log.warn(`sweep failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async onModuleInit() {
    if (process.env.ARS_SWEEPER === 'off') return;
    this.log.log(`CallMix forwarding control ${this.carrier.enabled ? 'enabled' : 'DISABLED (no CALLMIX_ID/CALLMIX_PW): only STATIC numbers can be used'}`);
    await this.pool.reconcileLinks().catch(() => undefined);
    this.timer = setInterval(() => { void this.tick(); }, 2000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Module({
  controllers: [ArsApiController, ArsInternalController, ArsAdminController, ArsPublicController, CustomerConsoleController],
  providers: [ArsSessionService, NumberPoolService, ArsSettingsService, IntegrityService, ApiKeyAuthService, RedisService, CarrierService, ArsSweeper],
  exports: [ArsSessionService, NumberPoolService, CarrierService],
})
export class ArsEngineModule {}
