import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AppPlatform, AuthEventType, AuthRequestStatus } from '@prisma/client';
import {
  hmacSha256,
  maskPhoneNumber,
  maskSensitivePayload,
  normalizePhoneNumber,
} from '../../common/crypto.util';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LegacyArsService } from './legacy-ars.service';
import { ArsConfirmDto, ArsInstallDto, ArsRecheckDto } from './ars-gateway.dto';

type VerifiedApiKey = {
  apiKeyId: string;
  keyHash: string;
  monthlyLimit: number;
  rateLimitPerMinute: number;
  applicationAppId: string;
};

@Injectable()
export class ArsGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly legacyArs: LegacyArsService,
  ) {}

  async install(dto: ArsInstallDto, meta: RequestMeta) {
    const verified = await this.verifyAndLimit(dto);

    const authRequest = await this.prisma.authRequest.create({
      data: {
        requestId: meta.requestId,
        apiKeyId: verified.apiKeyId,
        applicationAppId: verified.applicationAppId,
        mobileAppName: dto.mobile_app_name,
        clientPlatform: dto.client_platform,
        packageName: dto.package_name,
        bundleId: dto.bundle_id,
        appsid: dto.appsid,
        status: 'INSTALL_REQUESTED',
      },
    });

    try {
      const providerResponse = await this.legacyArs.install(dto.client_platform, {
        appsid: dto.appsid,
        app_os_type: dto.app_os_type,
        app_os_version: dto.app_os_version,
        app_cp_carr: dto.app_cp_carr ?? '',
        gcmid: dto.gcmid ?? 'deprecated',
        playerid: dto.playerid ?? 'deprecated',
      });

      const updated = await this.prisma.authRequest.update({
        where: { id: authRequest.id },
        data: {
          appuuid: String(providerResponse.appuuid ?? ''),
          appip: String(providerResponse.appip ?? ''),
          status: 'INSTALL_SUCCEEDED',
          providerMessage: String(providerResponse.msg ?? ''),
        },
      });
      await this.recordEvent({
        authRequestId: authRequest.id,
        apiKeyId: verified.apiKeyId,
        eventType: 'INSTALL',
        endpoint: '/v1/ars/install',
        httpStatus: 200,
        requestPayload: dto,
        responsePayload: providerResponse,
        meta,
      });
      return {
        ...providerResponse,
        request_id: meta.requestId,
        api_key_id: verified.apiKeyId,
        mobile_app_name: dto.mobile_app_name,
        appuuid: updated.appuuid,
      };
    } catch (error) {
      await this.prisma.authRequest.update({
        where: { id: authRequest.id },
        data: { status: 'INSTALL_FAILED', providerMessage: String(error) },
      });
      await this.recordProviderError(authRequest.id, verified.apiKeyId, 'INSTALL', '/v1/ars/install', dto, error, meta);
      throw error;
    }
  }

  async confirm(dto: ArsConfirmDto, meta: RequestMeta) {
    const verified = await this.verifyAndLimit(dto);
    const authRequest = await this.prisma.authRequest.findFirst({
      where: {
        apiKeyId: verified.apiKeyId,
        appsid: dto.appsid,
        appuuid: dto.appuuid,
      },
    });
    if (!authRequest) {
      throw new NotFoundException('AUTH_SESSION_NOT_FOUND');
    }

    await this.prisma.authRequest.update({
      where: { id: authRequest.id },
      data: { status: 'CONFIRM_REQUESTED' },
    });

    try {
      const providerResponse = await this.legacyArs.confirm(dto.client_platform, {
        appuuid: dto.appuuid,
        appsid: dto.appsid,
        applng: dto.applng ?? '0',
        applat: dto.applat ?? '0',
      });

      const callCount = Number(providerResponse.call_count ?? 0);
      const status = this.statusFromCallCount(callCount);
      await this.updateAuthResult(authRequest.id, status, callCount, providerResponse);
      await this.recordEvent({
        authRequestId: authRequest.id,
        apiKeyId: verified.apiKeyId,
        eventType: 'CONFIRM',
        endpoint: '/v1/ars/confirm',
        httpStatus: 200,
        requestPayload: dto,
        responsePayload: providerResponse,
        meta,
      });

      return {
        ...providerResponse,
        request_id: authRequest.requestId,
        api_key_id: verified.apiKeyId,
        mobile_app_name: dto.mobile_app_name,
      };
    } catch (error) {
      await this.recordProviderError(authRequest.id, verified.apiKeyId, 'CONFIRM', '/v1/ars/confirm', dto, error, meta);
      throw error;
    }
  }

  async recheck(dto: ArsRecheckDto, meta: RequestMeta) {
    const verified = await this.verifyAndLimit(dto);
    const authRequest = await this.prisma.authRequest.findFirst({
      where: {
        apiKeyId: verified.apiKeyId,
        appuuid: dto.appuuid,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!authRequest) {
      throw new NotFoundException('AUTH_SESSION_NOT_FOUND');
    }

    try {
      const providerResponse = await this.legacyArs.recheck({
        appuuid: dto.appuuid,
        appphone: dto.appphone,
      });
      const callCount = Number(providerResponse.call_count ?? 0);
      const status = callCount === 1 ? 'MANUAL_SUCCEEDED' : 'MANUAL_FAILED';
      await this.updateAuthResult(authRequest.id, status, callCount, providerResponse);
      await this.recordEvent({
        authRequestId: authRequest.id,
        apiKeyId: verified.apiKeyId,
        eventType: 'RECHECK',
        endpoint: '/v1/ars/recheck',
        httpStatus: 200,
        requestPayload: dto,
        responsePayload: providerResponse,
        meta,
      });
      return {
        ...providerResponse,
        request_id: authRequest.requestId,
        api_key_id: verified.apiKeyId,
        mobile_app_name: dto.mobile_app_name,
      };
    } catch (error) {
      await this.recordProviderError(authRequest.id, verified.apiKeyId, 'RECHECK', '/v1/ars/recheck', dto, error, meta);
      throw error;
    }
  }

  private async verifyAndLimit(dto: {
    api_key: string;
    mobile_app_name: string;
    client_platform: AppPlatform;
    package_name?: string;
    bundle_id?: string;
  }): Promise<VerifiedApiKey> {
    const keyHash = hmacSha256(
      process.env.API_KEY_HASH_SECRET ?? 'dev-api-key-secret',
      dto.api_key,
    );

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        application: {
          include: { apps: true },
        },
      },
    });
    if (!apiKey) {
      throw new UnauthorizedException('UNAUTHORIZED_API_KEY');
    }
    if (apiKey.status !== 'ACTIVE' || apiKey.application.status !== 'APPROVED') {
      throw new ForbiddenException('API_KEY_DISABLED');
    }

    const applicationApp = apiKey.application.apps.find((app) => {
      if (
        app.status !== 'APPROVED' ||
        app.mobileAppName !== dto.mobile_app_name ||
        app.platform !== dto.client_platform
      ) {
        return false;
      }
      if (dto.client_platform === 'ANDROID' && app.packageName && dto.package_name) {
        return app.packageName === dto.package_name;
      }
      if (dto.client_platform === 'IOS' && app.bundleId && dto.bundle_id) {
        return app.bundleId === dto.bundle_id;
      }
      return true;
    });

    if (!applicationApp) {
      throw new ForbiddenException('APP_NOT_ALLOWED');
    }

    const perMinute = apiKey.rateLimitPerMinute ?? 60;
    const minuteKey = `rate:${apiKey.id}:${Math.floor(Date.now() / 60_000)}`;
    const count = await this.redis.incrementWithTtl(minuteKey, 120);
    if (count > perMinute) {
      throw new HttpException('RATE_LIMIT_EXCEEDED', 429);
    }

    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      apiKeyId: apiKey.id,
      keyHash,
      monthlyLimit: apiKey.monthlyLimit,
      rateLimitPerMinute: perMinute,
      applicationAppId: applicationApp.id,
    };
  }

  private statusFromCallCount(callCount: number): AuthRequestStatus {
    if (callCount === 1) return 'AUTH_SUCCEEDED';
    if (callCount === 2) return 'MANUAL_REQUIRED';
    if (callCount === 0) return 'RETRY_REQUIRED';
    return 'AUTH_FAILED';
  }

  private async updateAuthResult(
    authRequestId: string,
    status: AuthRequestStatus,
    callCount: number,
    providerResponse: Record<string, unknown>,
  ) {
    const phone = normalizePhoneNumber(String(providerResponse.app_cid ?? ''));
    const phoneHash = phone
      ? hmacSha256(process.env.PHONE_HASH_SECRET ?? 'dev-phone-secret', phone)
      : null;
    await this.prisma.authRequest.update({
      where: { id: authRequestId },
      data: {
        status,
        callCount,
        confirmedAt: new Date(),
        providerMessage: String(providerResponse.msg ?? ''),
        phoneHash,
        phoneMasked: maskPhoneNumber(phone),
      },
    });
  }

  private async recordEvent(input: {
    authRequestId?: string;
    apiKeyId?: string;
    eventType: AuthEventType;
    endpoint: string;
    httpStatus?: number;
    errorCode?: string;
    message?: string;
    requestPayload?: unknown;
    responsePayload?: unknown;
    meta: RequestMeta;
  }) {
    await this.prisma.authEvent.create({
      data: {
        authRequestId: input.authRequestId,
        apiKeyId: input.apiKeyId,
        eventType: input.eventType,
        endpoint: input.endpoint,
        httpStatus: input.httpStatus,
        errorCode: input.errorCode,
        message: input.message,
        requestPayloadMasked: maskSensitivePayload(input.requestPayload) as object,
        responsePayloadMasked: maskSensitivePayload(input.responsePayload) as object,
        ipAddress: input.meta.ipAddress,
        userAgent: input.meta.userAgent,
      },
    });
  }

  private async recordProviderError(
    authRequestId: string,
    apiKeyId: string,
    eventType: AuthEventType,
    endpoint: string,
    requestPayload: unknown,
    error: unknown,
    meta: RequestMeta,
  ) {
    await this.recordEvent({
      authRequestId,
      apiKeyId,
      eventType,
      endpoint,
      httpStatus: 502,
      errorCode: 'ARS_PROVIDER_ERROR',
      message: error instanceof Error ? error.message : String(error),
      requestPayload,
      responsePayload: { error: String(error) },
      meta,
    });
  }
}

export type RequestMeta = {
  requestId: string;
  ipAddress?: string;
  userAgent?: string;
};
