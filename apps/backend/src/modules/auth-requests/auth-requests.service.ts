import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthRequestStatus } from '@prisma/client';
import { AuthenticatedPrincipal } from '../../common/auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(
    principal: AuthenticatedPrincipal,
    filters: { status?: AuthRequestStatus; apiKeyId?: string },
  ) {
    const userFilter =
      principal.kind === 'admin' ? {} : { apiKey: { application: { userId: principal.id } } };
    return this.prisma.authRequest.findMany({
      where: {
        ...userFilter,
        status: filters.status,
        apiKeyId: filters.apiKeyId,
      },
      include: {
        apiKey: { select: { id: true, keyPrefix: true } },
        applicationApp: true,
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
  }

  async getForUser(principal: AuthenticatedPrincipal, requestId: string) {
    const authRequest = await this.prisma.authRequest.findUnique({
      where: { requestId },
      include: {
        events: { orderBy: { createdAt: 'asc' } },
        apiKey: { include: { application: true } },
        applicationApp: true,
      },
    });
    if (!authRequest) {
      throw new NotFoundException('Auth request not found');
    }
    if (
      principal.kind !== 'admin' &&
      authRequest.apiKey.application.userId !== principal.id
    ) {
      throw new ForbiddenException('Auth request belongs to another user');
    }
    return authRequest;
  }
}
