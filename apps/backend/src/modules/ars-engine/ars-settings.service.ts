import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type ArsSettings = {
  leaseSecondsApp: number;      // time the app has to place the call
  leaseSecondsPc: number;       // time for QR scan + call (PC mode)
  cooldownSeconds: number;      // a number rests this long after a session ends
  authlogWaitSeconds: number;   // PBX waits at most this long for the carrier AuthLog
  confirmKeyRequired: boolean;  // caller must press 1 after the phishing notice
  pcCodeEnabled: boolean;       // PC mode: ARS reads 2 digits the user types on the PC
  pcCodeMaxAttempts: number;
  mobileOnly: boolean;          // only 010/011/016~019 callers can authenticate
};

export const ARS_SETTING_DEFAULTS: ArsSettings = {
  leaseSecondsApp: 60,
  leaseSecondsPc: 120,
  cooldownSeconds: 120,
  authlogWaitSeconds: 6,
  confirmKeyRequired: true,
  pcCodeEnabled: true,
  pcCodeMaxAttempts: 3,
  mobileOnly: true,
};

const BOUNDS: Record<string, [number, number]> = {
  leaseSecondsApp: [20, 600],
  leaseSecondsPc: [30, 900],
  cooldownSeconds: [0, 3600],
  authlogWaitSeconds: [1, 20],
  pcCodeMaxAttempts: [1, 10],
};

@Injectable()
export class ArsSettingsService {
  private cache: { at: number; value: ArsSettings } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ArsSettings> {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.value;
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { startsWith: 'ars.' } } });
    const value: ArsSettings = { ...ARS_SETTING_DEFAULTS };
    for (const r of rows) {
      const k = r.key.slice(4) as keyof ArsSettings;
      if (k in value && typeof r.value === typeof value[k]) (value as Record<string, unknown>)[k] = r.value;
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(patch: Partial<Record<keyof ArsSettings, unknown>>, actor: string): Promise<ArsSettings> {
    const errors: string[] = [];
    const clean: Partial<ArsSettings> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in ARS_SETTING_DEFAULTS)) { errors.push(`unknown setting ${k}`); continue; }
      const def = (ARS_SETTING_DEFAULTS as Record<string, unknown>)[k];
      if (typeof def === 'boolean') {
        if (typeof v !== 'boolean') { errors.push(`${k} must be boolean`); continue; }
      } else {
        const [min, max] = BOUNDS[k];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) { errors.push(`${k} must be an integer ${min}..${max}`); continue; }
      }
      (clean as Record<string, unknown>)[k] = v;
    }
    if (errors.length) throw new BadRequestException(errors);
    const before = await this.get();
    await this.prisma.$transaction(async (tx) => {
      for (const [k, v] of Object.entries(clean)) {
        await tx.systemSetting.upsert({ where: { key: `ars.${k}` }, update: { value: v as never, updatedBy: actor }, create: { key: `ars.${k}`, value: v as never, updatedBy: actor } });
      }
      const changed = Object.fromEntries(Object.entries(clean).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v)
        .map(([k, v]) => [k, { old: (before as Record<string, unknown>)[k], new: v }]));
      if (Object.keys(changed).length) {
        await tx.auditLog.create({ data: { actorType: 'ADMIN', actorId: actor, action: 'ARS_SETTINGS_UPDATE', targetType: 'SYSTEM_SETTING', details: changed as never } });
      }
    });
    this.cache = null;
    return this.get();
  }
}
