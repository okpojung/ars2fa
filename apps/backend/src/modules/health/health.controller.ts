import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      ok: true,
      service: 'ars2fa-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
