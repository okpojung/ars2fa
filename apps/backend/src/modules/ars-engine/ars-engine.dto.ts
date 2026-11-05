import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AppPlatform } from '@prisma/client';

export class ClientDto {
  @IsOptional() @IsString() api_key?: string; // or Authorization: Bearer
  @IsString() @IsNotEmpty() @MaxLength(100) mobile_app_name!: string;
  @IsEnum(AppPlatform) client_platform!: AppPlatform;
  @IsOptional() @IsString() @MaxLength(200) package_name?: string;
  @IsOptional() @IsString() @MaxLength(200) bundle_id?: string;
  @IsOptional() @IsString() @MaxLength(40) sdk_version?: string;
}

export class IntegrityFieldsDto extends ClientDto {
  @IsOptional() @IsString() @MaxLength(100) integrity_nonce?: string;
  @IsOptional() @IsString() @MaxLength(20000) integrity_token?: string;
  @IsOptional() @IsString() @MaxLength(200) attest_key_id?: string;
  @IsOptional() @IsString() @MaxLength(20000) attest_assertion?: string;
}

export class CreateSessionDto extends IntegrityFieldsDto {
  @IsOptional() @IsIn(['APP', 'PC']) mode?: 'APP' | 'PC';
  @IsOptional() @IsString() @MaxLength(100) appsid?: string;
  @IsOptional() @IsString() @MaxLength(40) purpose?: string;
  @IsOptional() @IsString() @MaxLength(20) expected_phone?: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9]{1,4}$/) country_code?: string;
  /** APP call flow: 0 = no key press (decided on connect), 1 = press 1 after the notice. Omitted = app / customer setting. */
  @IsOptional() @IsIn([0, 1, '0', '1']) type?: 0 | 1 | '0' | '1';
}

export class SessionRefDto extends ClientDto {
  @IsString() @Matches(/^ars_[A-Za-z0-9_-]{10,40}$/) session_id!: string;
}

export class AttestRegisterDto extends ClientDto {
  @IsString() @IsNotEmpty() @MaxLength(200) key_id!: string;
  @IsString() @IsNotEmpty() @MaxLength(20000) attestation!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) integrity_nonce!: string;
}

// ------------------------------------------------------------------ internal (PBX / receiver)

export class PbxVerifyDto {
  @IsString() @MaxLength(20) rn!: string;
  @IsOptional() @IsString() @MaxLength(80) caller?: string;
  @IsString() @MaxLength(64) uid!: string;
  @IsOptional() @IsString() @Matches(/^[0-9]{9,11}$/) t0?: string;
  @IsOptional() @IsString() @MaxLength(4) confirm?: string;
  /** connect only: wait at most this many seconds for the AuthLog and answer WAIT if it is not there yet (the PBX plays a short message and asks again) */
  @IsOptional() @IsString() @Matches(/^[0-9]{1,2}(\.[0-9])?$/) wait?: string;
  @IsOptional() @IsString() @MaxLength(200) key?: string;
}

export class AuthLogDto {
  @IsString() @MaxLength(20) vn!: string;
  @IsOptional() @IsString() @MaxLength(30) an?: string;
  @IsString() @MaxLength(30) callStartTime!: string;
  @IsString() @MaxLength(64) callId!: string;
  @IsOptional() @IsString() @MaxLength(200) key?: string;
}

// ------------------------------------------------------------------ admin

export class ImportPoolDto {
  @IsString({ each: true }) numbers!: string[];
  @IsString({ each: true }) lines!: string[];
  @IsOptional() @IsBoolean() remap_rn?: boolean;
}

export class VnStatusDto {
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
  @IsOptional() @IsIn(['DYNAMIC', 'STATIC']) routing?: 'DYNAMIC' | 'STATIC';
}

export class PbxPrecheckDto {
  @IsString() @MaxLength(20) rn!: string;
  @IsOptional() @IsString() @MaxLength(64) uid?: string;
  @IsOptional() @IsString() @MaxLength(80) caller?: string;
  @IsOptional() @IsString() @MaxLength(200) key?: string;
}

export class PbxCodeDto {
  @IsString() @MaxLength(64) uid!: string;
  @IsOptional() @IsString() @MaxLength(12) code?: string;
  @IsOptional() @IsString() @MaxLength(200) key?: string;
}

export class PbxHangupDto {
  @IsString() @MaxLength(64) uid!: string;
  @IsOptional() @IsString() @MaxLength(200) key?: string;
}

export class AppSecurityDto {
  @IsOptional() @IsIn(['OFF', 'MONITOR', 'ENFORCE']) integrityPolicy?: 'OFF' | 'MONITOR' | 'ENFORCE';
  @IsOptional() @IsString() @MaxLength(40) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) androidCertSha256?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9]{10}$|^$/) iosTeamId?: string;
  /** needed only for app forgery protection (Play Integrity / App Attest); empty = not registered */
  @IsOptional() @IsString() @Matches(/^$|^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/) @MaxLength(200) packageName?: string;
  @IsOptional() @IsString() @Matches(/^$|^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/) @MaxLength(200) bundleId?: string;
}

export class ArsSettingsDto {
  @IsOptional() @IsInt() leaseSecondsApp?: number;
  @IsOptional() @IsInt() leaseSecondsPc?: number;
  @IsOptional() @IsInt() pcCodeSeconds?: number;
  @IsOptional() @IsInt() pcCodeDigits?: number;
  @IsOptional() @IsInt() cooldownSeconds?: number;
  @IsOptional() @IsInt() authlogWaitSeconds?: number;
  @IsOptional() @IsBoolean() confirmKeyRequired?: boolean;
  @IsOptional() @IsBoolean() pcCodeEnabled?: boolean;
  @IsOptional() @IsInt() pcCodeMaxAttempts?: number;
  @IsOptional() @IsBoolean() mobileOnly?: boolean;
}
