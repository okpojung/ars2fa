import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseOrigins } from '../ars-engine/widget.service';
import { AdminService } from './admin.service';

/**
 * Submitted API applications are approved automatically AUTO_APPROVE_MINUTES (default 10) after submission,
 * unless the app identity is already registered by another customer (Android package, iOS Bundle ID or widget
 * site address): those stay for an admin, with the reason in adminComment. AUTO_APPROVE_MINUTES=0 turns it off.
 * Admins can approve or reject by hand before that.
 */
@Injectable()
export class AutoApproveService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('AutoApprove');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly admin: AdminService) {}

  static minutes() {
    const n = Number(process.env.AUTO_APPROVE_MINUTES ?? 10);
    return Number.isFinite(n) && n >= 0 ? n : 10;
  }

  onModuleInit() {
    if (AutoApproveService.minutes() === 0 || process.env.AUTO_APPROVE === 'off') return;
    this.timer = setInterval(() => { void this.tick(); }, 30_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Why an application must wait for an admin, or null when it may be approved automatically. */
  async conflict(applicationId: string): Promise<string | null> {
    const app = await this.prisma.apiApplication.findUniqueOrThrow({ where: { id: applicationId }, include: { apps: true } });
    const others = await this.prisma.applicationApp.findMany({
      // only identities another customer already holds (approved); two pending duplicates do not block each other
      where: { status: 'APPROVED', application: { userId: { not: app.userId } } },
      select: { platform: true, packageName: true, bundleId: true, allowedOrigins: true },
    });
    for (const a of app.apps) {
      if (a.platform === 'ANDROID' && a.packageName && others.some((o) => o.platform === 'ANDROID' && o.packageName === a.packageName)) return `다른 고객이 등록한 Android 패키지명 (${a.packageName})`;
      if (a.platform === 'IOS' && a.bundleId && others.some((o) => o.platform === 'IOS' && o.bundleId === a.bundleId)) return `다른 고객이 등록한 iOS Bundle ID (${a.bundleId})`;
      if (a.platform === 'WEB') {
        const taken = new Set(others.flatMap((o) => parseOrigins(o.allowedOrigins)));
        const dup = parseOrigins(a.allowedOrigins).find((o) => taken.has(o));
        if (dup) return `다른 고객이 등록한 사이트 주소 (${dup})`;
      }
    }
    return null;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.apiApplication.findMany({
        where: { status: 'SUBMITTED', submittedAt: { lte: new Date(Date.now() - AutoApproveService.minutes() * 60_000) } },
        select: { id: true, adminComment: true }, orderBy: { submittedAt: 'asc' }, take: 20,
      });
      for (const d of due) {
        const why = await this.conflict(d.id);
        if (why) {
          const note = `자동 승인 보류: ${why}. 관리자 확인이 필요합니다.`;
          if (d.adminComment !== note) await this.prisma.apiApplication.update({ where: { id: d.id }, data: { adminComment: note } });
          continue;
        }
        await this.admin.approve(d.id, null, `자동 승인 (제출 ${AutoApproveService.minutes()}분 후)`).then(
          () => this.log.log(`auto-approved ${d.id}`),
          (e) => this.log.warn(`auto-approve ${d.id} failed: ${(e as Error).message}`),
        );
      }
    } catch (e) {
      this.log.warn(`auto-approve pass failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
