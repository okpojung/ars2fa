import { sealText } from '../ars-engine/phone.util';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hmacSha256, generateApiKey, getKeyPrefix } from '../../common/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async requestRevision(applicationId: string, adminId: string, comment?: string) {
    const application = await this.getApplicationOrThrow(applicationId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiApplication.update({
        where: { id: applicationId },
        data: {
          status: 'NEEDS_REVISION',
          adminComment: comment,
        },
      });
      await tx.reviewHistory.create({
        data: {
          applicationId,
          adminUserId: adminId,
          fromStatus: application.status,
          toStatus: 'NEEDS_REVISION',
          comment,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'APPLICATION_REVISION_REQUEST',
          targetType: 'API_APPLICATION',
          targetId: applicationId,
          details: { comment },
        },
      });
      return updated;
    });
  }

  async reject(applicationId: string, adminId: string, comment?: string) {
    const application = await this.getApplicationOrThrow(applicationId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiApplication.update({
        where: { id: applicationId },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          adminComment: comment,
        },
      });
      await tx.reviewHistory.create({
        data: {
          applicationId,
          adminUserId: adminId,
          fromStatus: application.status,
          toStatus: 'REJECTED',
          comment,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'APPLICATION_REJECT',
          targetType: 'API_APPLICATION',
          targetId: applicationId,
          details: { comment },
        },
      });
      return updated;
    });
  }

  async approve(applicationId: string, adminId: string, comment?: string) {
    const application = await this.getApplicationOrThrow(applicationId);
    if (application.status !== 'SUBMITTED') {
      throw new ForbiddenException('Only submitted applications can be approved');
    }

    const rawApiKey = generateApiKey('TEST');
    const keyHash = hmacSha256(
      process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret',
      rawApiKey,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiApplication.update({
        where: { id: applicationId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          adminComment: comment,
          apps: {
            updateMany: {
              where: { applicationId },
              data: { status: 'APPROVED' },
            },
          },
        },
        include: { apps: true },
      });
      const apiKey = await tx.apiKey.create({
        data: {
          applicationId,
          keyHash,
          keyPrefix: getKeyPrefix(rawApiKey),
          keyEnc: sealText(rawApiKey),
          environment: 'TEST',
          status: 'ACTIVE',
          // monthly limit: default unless the (old) application form gave a number; adjustable in API Key 운영
          monthlyLimit: application.expectedMonthlyRequests > 0 ? application.expectedMonthlyRequests : Number(process.env.DEFAULT_MONTHLY_LIMIT ?? 10000),
          rateLimitPerMinute: 60,
        },
      });
      await tx.reviewHistory.create({
        data: {
          applicationId,
          adminUserId: adminId,
          fromStatus: application.status,
          toStatus: 'APPROVED',
          comment,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'APPLICATION_APPROVE_AND_KEY_ISSUE',
          targetType: 'API_APPLICATION',
          targetId: applicationId,
          details: { apiKeyId: apiKey.id, keyPrefix: apiKey.keyPrefix },
        },
      });
      return { application: updated, apiKey };
    });

    // the secret is not shown to the admin: the customer takes it in the console after an ARS phone check
    return {
      ...result,
      notice: '승인했습니다. 고객이 콘솔 API Key 메뉴에서 휴대폰 ARS 인증 후 키를 받습니다.',
    };
  }

  listAuditLogs() {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        companyName: true,
        contactName: true,
        status: true,
        createdAt: true,
      },
    });
  }

  private async getApplicationOrThrow(applicationId: string) {
    const application = await this.prisma.apiApplication.findUnique({
      where: { id: applicationId },
      include: { apps: true },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    return application;
  }
}
