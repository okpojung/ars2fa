import { Module } from '@nestjs/common';
import { ArsEngineModule } from '../ars-engine/ars-engine.module';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [ArsEngineModule],
  controllers: [StatisticsController],
  providers: [StatisticsService],
})
export class StatisticsModule {}
