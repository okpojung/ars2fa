import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ApplicationApp, IntegrityVerdict } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { verifyAssertion, verifyAttestation } from './app-attest';
import { PlayIntegrityVerifier } from './play-integrity';

export type IntegrityInput = {
  integrity_nonce?: string;      // from POST /v1/ars/integrity/challenge
  integrity_token?: string;      // Android Play Integrity token (nonce/requestHash = integrity_nonce)
  attest_key_id?: string;        // iOS App Attest key id (base64), registered via /v1/ars/integrity/ios/attest
  attest_assertion?: string;     // iOS assertion (base64) over clientDataHash = SHA256(integrity_nonce)
};

export type IntegrityOutcome = { verdict: IntegrityVerdict; detail: Record<string, unknown> };

const CHALLENGE_TTL_MS = 5 * 60_000;

@Injectable()
export class IntegrityService {
  play = new PlayIntegrityVerifier();
  appleRootPem?: string; // test hook

  constructor(private readonly prisma: PrismaService) {}

  async challenge(apiKeyId: string, applicationAppId: string) {
    const nonce = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
    await this.prisma.integrityChallenge.create({ data: { nonce, apiKeyId, applicationAppId, expiresAt } });
    return { nonce, expires_at: expiresAt.toISOString() };
  }

  /** Marks the challenge used; it is single use and bound to the key + app. */
  private async consume(nonce: string | undefined, apiKeyId: string, appId: string): Promise<boolean> {
    if (!nonce) return false;
    const r = await this.prisma.integrityChallenge.updateMany({
      where: { nonce, apiKeyId, applicationAppId: appId, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return r.count === 1;
  }

  appIdOf(app: ApplicationApp): string | null {
    return app.iosTeamId && app.bundleId ? `${app.iosTeamId}.${app.bundleId}` : null;
  }

  /** Registers an App Attest key for an iOS app (one-time per device install). */
  async registerAttestKey(app: ApplicationApp, apiKeyId: string, body: { key_id: string; attestation: string; integrity_nonce: string }) {
    const appId = this.appIdOf(app);
    if (app.platform !== 'IOS' || !appId) throw new BadRequestException('APP_ATTEST_NOT_CONFIGURED');
    if (!(await this.consume(body.integrity_nonce, apiKeyId, app.id))) throw new ForbiddenException('INTEGRITY_CHALLENGE_INVALID');
    try {
      const res = verifyAttestation({ attestationObject: Buffer.from(body.attestation, 'base64'), keyIdB64: body.key_id, challenge: body.integrity_nonce, appId, rootPem: this.appleRootPem });
      await this.prisma.appAttestKey.upsert({
        where: { keyId: body.key_id },
        update: {},
        create: { applicationAppId: app.id, keyId: body.key_id, publicKeyPem: res.publicKeyPem, environment: res.environment, signCount: 0 },
      });
      return { registered: true, environment: res.environment };
    } catch (e) {
      throw new ForbiddenException({ code: 'APP_ATTEST_FAILED', reason: (e as Error).message });
    }
  }

  /** Evaluates the integrity proof sent with a session request and applies the app policy. */
  async evaluate(app: ApplicationApp, apiKeyId: string, input: IntegrityInput): Promise<IntegrityOutcome> {
    const policy = app.integrityPolicy;
    if (policy === 'OFF') return { verdict: 'SKIPPED', detail: { policy } };
    const out = await this.check(app, apiKeyId, input);
    out.detail.policy = policy;
    if (policy === 'ENFORCE' && out.verdict !== 'PASSED') {
      throw new ForbiddenException({ code: 'APP_INTEGRITY_FAILED', verdict: out.verdict, reasons: out.detail.reasons ?? [] });
    }
    return out;
  }

  private async check(app: ApplicationApp, apiKeyId: string, input: IntegrityInput): Promise<IntegrityOutcome> {
    const hasProof = app.platform === 'ANDROID' ? !!input.integrity_token : !!(input.attest_key_id && input.attest_assertion);
    if (!hasProof) return { verdict: 'NOT_PROVIDED', detail: {} };
    if (!(await this.consume(input.integrity_nonce, apiKeyId, app.id))) return { verdict: 'FAILED', detail: { reasons: ['challenge_invalid'] } };
    const nonce = input.integrity_nonce!;
    if (app.platform === 'ANDROID') {
      if (!app.packageName) return { verdict: 'ERROR', detail: { reasons: ['package_not_registered'] } };
      if (!this.play.configured) return { verdict: 'ERROR', detail: { reasons: ['play_integrity_not_configured'] } };
      try {
        const payload = await this.play.decode(app.packageName, input.integrity_token!);
        const v = PlayIntegrityVerifier.evaluate(payload, { packageName: app.packageName, nonce,
          certSha256: app.androidCertSha256?.split(',').map((s) => s.trim()).filter(Boolean) });
        return { verdict: v.ok ? 'PASSED' : 'FAILED', detail: { reasons: v.reasons, ...v.summary } };
      } catch (e) {
        return { verdict: 'ERROR', detail: { reasons: ['play_integrity_error'], error: (e as Error).message.slice(0, 120) } };
      }
    }
    const appId = this.appIdOf(app);
    if (!appId) return { verdict: 'ERROR', detail: { reasons: ['app_attest_not_configured'] } };
    const key = await this.prisma.appAttestKey.findFirst({ where: { keyId: input.attest_key_id!, applicationAppId: app.id } });
    if (!key) return { verdict: 'FAILED', detail: { reasons: ['attest_key_unknown'] } };
    try {
      const count = verifyAssertion({ assertion: Buffer.from(input.attest_assertion!, 'base64'), challenge: nonce, appId, publicKeyPem: key.publicKeyPem, storedCount: key.signCount });
      const upd = await this.prisma.appAttestKey.updateMany({ where: { id: key.id, signCount: key.signCount }, data: { signCount: count, lastUsedAt: new Date() } });
      if (upd.count !== 1) return { verdict: 'FAILED', detail: { reasons: ['assertion_replay'] } };
      return { verdict: 'PASSED', detail: { environment: key.environment } };
    } catch (e) {
      return { verdict: 'FAILED', detail: { reasons: [(e as Error).message] } };
    }
  }
}
