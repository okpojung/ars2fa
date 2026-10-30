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
}

export class SessionRefDto extends ClientDto {
  @IsString() @Matches(/^ars_[A-Za-z0-9_-]{10,40}$/) session_id!: string;
}

export class PcCodeDto extends SessionRefDto {
  @IsString() @Matches(/^[0-9]{1,4}$/) code!: string;
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
  @IsIn(['ACTIVE', 'DISABLED']) status!: 'ACTIVE' | 'DISABLED';
}

export class AppSecurityDto {
  @IsOptional() @IsIn(['OFF', 'MONITOR', 'ENFORCE']) integrityPolicy?: 'OFF' | 'MONITOR' | 'ENFORCE';
  @IsOptional() @IsString() @MaxLength(40) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) androidCertSha256?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9]{10}$|^$/) iosTeamId?: string;
}

export class ArsSettingsDto {
  @IsOptional() @IsInt() leaseSecondsApp?: number;
  @IsOptional() @IsInt() leaseSecondsPc?: number;
  @IsOptional() @IsInt() cooldownSeconds?: number;
  @IsOptional() @IsInt() authlogWaitSeconds?: number;
  @IsOptional() @IsBoolean() confirmKeyRequired?: boolean;
  @IsOptional() @IsBoolean() pcCodeEnabled?: boolean;
  @IsOptional() @IsInt() pcCodeMaxAttempts?: number;
  @IsOptional() @IsBoolean() mobileOnly?: boolean;
}
