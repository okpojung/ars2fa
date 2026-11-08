import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AppPlatform } from '@prisma/client';

export class ApplicationAppDto {
  @IsString()
  @IsNotEmpty()
  mobileAppName!: string;

  @IsEnum(AppPlatform)
  platform!: AppPlatform;

  @IsOptional()
  @IsString()
  packageName?: string;

  @IsOptional()
  @IsString()
  bundleId?: string;

  @IsOptional()
  @IsString()
  storeUrl?: string;

  /** ANDROID / IOS: press 1 after the notice (null / omitted = service default) */
  @IsOptional()
  @IsBoolean()
  confirmKeyRequired?: boolean;

  /** WEB: digits of the code shown in the popup, 3..6 (omitted = service default) */
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(6)
  pcCodeDigits?: number;

  /** time to place the call, seconds 15..120 (omitted = service default) */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(120)
  leaseSeconds?: number;

  /** WEB: time to key in the code, seconds 10..60 (omitted = service default) */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(60)
  pcCodeSeconds?: number;

  /** WEB: origins allowed to use the widget, comma separated (https://example.com) */
  @IsOptional()
  @IsString()
  allowedOrigins?: string;
}

export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  serviceName!: string;

  /** no longer asked in the console form (kept optional for API compatibility) */
  @IsOptional()
  @IsString()
  usagePurpose?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  expectedMonthlyRequests?: number;

  @IsOptional()
  @IsString()
  allowedIps?: string;

  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @ValidateNested({ each: true })
  @Type(() => ApplicationAppDto)
  apps!: ApplicationAppDto[];
}

export class UpdateApplicationDto extends CreateApplicationDto {}
