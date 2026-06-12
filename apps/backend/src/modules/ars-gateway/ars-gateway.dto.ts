import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AppPlatform } from '@prisma/client';

export class ArsBaseDto {
  @IsString()
  @IsNotEmpty()
  api_key!: string;

  @IsString()
  @IsNotEmpty()
  mobile_app_name!: string;

  @IsEnum(AppPlatform)
  client_platform!: AppPlatform;

  @IsOptional()
  @IsString()
  package_name?: string;

  @IsOptional()
  @IsString()
  bundle_id?: string;
}

export class ArsInstallDto extends ArsBaseDto {
  @IsString()
  @IsNotEmpty()
  appsid!: string;

  @IsString()
  @IsNotEmpty()
  app_os_type!: string;

  @IsString()
  @IsNotEmpty()
  app_os_version!: string;

  @IsOptional()
  @IsString()
  app_cp_carr?: string;

  @IsOptional()
  @IsString()
  gcmid?: string;

  @IsOptional()
  @IsString()
  playerid?: string;
}

export class ArsConfirmDto extends ArsBaseDto {
  @IsString()
  @IsNotEmpty()
  appuuid!: string;

  @IsString()
  @IsNotEmpty()
  appsid!: string;

  @IsOptional()
  @IsString()
  applng?: string;

  @IsOptional()
  @IsString()
  applat?: string;
}

export class ArsRecheckDto extends ArsBaseDto {
  @IsString()
  @IsNotEmpty()
  appuuid!: string;

  @IsString()
  @IsNotEmpty()
  appphone!: string;
}
