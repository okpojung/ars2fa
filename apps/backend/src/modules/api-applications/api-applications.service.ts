import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateApplicationDto,
  UpdateApplicationDto,
} from './api-applications.dto';

@Injectable()
export class ApiApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.apiApplication.findMany({
      where: { userId },
      include: { apps: true, apiKeys: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOwned(userId: string, id: string) {
    const application = await this.prisma.apiApplication.findUnique({
      where: { id },
      include: { apps: true, apiKeys: true, reviewHistories: true },
    });
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    if (application.userId !== userId) {
      throw new ForbiddenException('Application belongs to another user');
    }
    return application;
  }

  create(userId: string, dto: CreateApplicationDto) {
    return this.prisma.apiApplication.create({
      data: {
        userId,
        serviceName: dto.serviceName,
        usagePurpose: dto.usagePurpose,
        expectedMonthlyRequests: dto.expectedMonthlyRequests,
        allowedIps: dto.allowedIps,
        callbackUrl: dto.callbackUrl,
        apps: {
          create: dto.apps.map((app) => ({
            mobileAppName: app.mobileAppName,
            platform: app.platform,
            packageName: app.packageName,
            bundleId: app.bundleId,
            storeUrl: app.storeUrl,
          })),
        },
      },
      include: { apps: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateApplicationDto) {
    const application = await this.getOwned(userId, id);
    if (
      !['DRAFT', 'NEEDS_REVISION'].includes(application.status)
    ) {
      throw new ForbiddenException('Only draft or revision applications can be edited');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.applicationApp.deleteMany({ where: { applicationId: id } });
      return tx.apiApplication.update({
        where: { id },
        data: {
          serviceName: dto.serviceName,
          usagePurpose: dto.usagePurpose,
          expectedMonthlyRequests: dto.expectedMonthlyRequests,
          allowedIps: dto.allowedIps,
          callbackUrl: dto.callbackUrl,
          apps: {
            create: dto.apps.map((app) => ({
              mobileAppName: app.mobileAppName,
              platform: app.platform,
              packageName: app.packageName,
              bundleId: app.bundleId,
              storeUrl: app.storeUrl,
            })),
          },
        },
        include: { apps: true },
      });
    });
  }

  async submit(userId: string, id: string) {
    const application = await this.getOwned(userId, id);
    if (!['DRAFT', 'NEEDS_REVISION'].includes(application.status)) {
      throw new ForbiddenException('Application cannot be submitted');
    }

    return this.prisma.apiApplication.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
      include: { apps: true },
    });
  }

  adminList(status?: ApplicationStatus) {
    return this.prisma.apiApplication.findMany({
      where: status ? { status } : undefined,
      include: { user: true, apps: true, apiKeys: true },
      orderBy: { submittedAt: { sort: 'desc', nulls: 'last' } },
    });
  }

  adminGet(id: string) {
    return this.prisma.apiApplication.findUnique({
      where: { id },
      include: {
        user: true,
        apps: true,
        apiKeys: true,
        reviewHistories: { orderBy: { createdAt: 'desc' } },
      },
    });
  }
}
