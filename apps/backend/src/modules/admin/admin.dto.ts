import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdminCommentDto {
  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdateApiKeyLimitsDto {
  @IsInt()
  @Min(1)
  monthlyLimit!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimitPerMinute?: number;
}
