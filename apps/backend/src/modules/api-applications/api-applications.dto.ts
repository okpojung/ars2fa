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
}

export class CreateApplicationDto {
  @IsString()
  @IsNotEmpty()
  serviceName!: string;

  @IsString()
  @IsNotEmpty()
  usagePurpose!: string;

  @IsInt()
  @Min(1)
  expectedMonthlyRequests!: number;

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
