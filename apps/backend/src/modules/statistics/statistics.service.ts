import { Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../common/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(principal: AuthenticatedPrincipal) {
    const where =
      principal.kind === 'admin'
        ? {}
        : { apiKey: { application: { userId: principal.id } } };

    const [total, success, failed, manualRequired] = await Promise.all([
      this.prisma.authRequest.count({ where }),
      this.prisma.authRequest.count({
        where: { ...where, status: { in: ['AUTH_SUCCEEDED', 'MANUAL_SUCCEEDED'] } },
      }),
      this.prisma.authRequest.count({
        where: { ...where, status: { in: ['AUTH_FAILED', 'INSTALL_FAILED', 'MANUAL_FAILED'] } },
      }),
      this.prisma.authRequest.count({
        where: { ...where, status: 'MANUAL_REQUIRED' },
      }),
    ]);

    return {
      total,
      success,
      failed,
      manualRequired,
      successRate: total === 0 ? 0 : Number(((success / total) * 100).toFixed(2)),
    };
  }
}
