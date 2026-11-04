import { parseOrigins } from '../ars-engine/widget.service';
import {
  BadRequestException,
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

/** WEB apps: normalized allowed origins; app integrity checks do not apply to web sites. */
function webFields(app: { platform: string; allowedOrigins?: string }) {
  return app.platform === 'WEB' ? { allowedOrigins: parseOrigins(app.allowedOrigins).join(',') || null, integrityPolicy: 'OFF' as const } : {};
}

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

  /** Android needs the package name, iOS the Bundle ID (app identity on every API call and for app integrity). */
  private checkApps(dto: CreateApplicationDto) {
    for (const a of dto.apps ?? []) {
      if (a.packageName) a.packageName = a.packageName.trim();
      if (a.bundleId) a.bundleId = a.bundleId.trim();
      if (a.platform === 'ANDROID' && !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(a.packageName ?? ''))
        throw new BadRequestException('Android 패키지명을 입력하세요. (예: com.example.app)');
      if (a.platform === 'IOS' && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(a.bundleId ?? ''))
        throw new BadRequestException('iOS Bundle ID를 입력하세요. (예: com.example.app)');
    }
  }

  create(userId: string, dto: CreateApplicationDto) {
    this.checkApps(dto);
    return this.prisma.apiApplication.create({
      data: {
        userId,
        serviceName: dto.serviceName,
        usagePurpose: dto.usagePurpose ?? '',
        expectedMonthlyRequests: dto.expectedMonthlyRequests ?? 0,
        allowedIps: dto.allowedIps,
        callbackUrl: dto.callbackUrl,
        apps: {
          create: dto.apps.map((app) => ({
            mobileAppName: app.mobileAppName,
            platform: app.platform,
            packageName: app.packageName,
            bundleId: app.bundleId,
            storeUrl: app.storeUrl,
            ...webFields(app),
          })),
        },
      },
      include: { apps: true },
    });
  }

  async update(userId: string, id: string, dto: UpdateApplicationDto) {
    this.checkApps(dto);
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
          usagePurpose: dto.usagePurpose ?? '',
          expectedMonthlyRequests: dto.expectedMonthlyRequests ?? 0,
          allowedIps: dto.allowedIps,
          callbackUrl: dto.callbackUrl,
          apps: {
            create: dto.apps.map((app) => ({
              mobileAppName: app.mobileAppName,
              platform: app.platform,
              packageName: app.packageName,
              bundleId: app.bundleId,
              storeUrl: app.storeUrl,
              ...webFields(app),
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
