import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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
