import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsDateString,
  IsBoolean,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';

export class EnqueueArticlesDto {
  @IsArray()
  @IsString({ each: true })
  articleIds: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  delayMs?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** Minutes between each article when scheduling a batch */
  @IsOptional()
  @IsNumber()
  @Min(0)
  intervalMinutes?: number;
}

export class EnqueueByTitlesDto {
  @IsString()
  siteId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  titles: string[];

  @IsDateString()
  scheduledAt: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** Minutes between each article when scheduling a batch */
  @IsOptional()
  @IsNumber()
  @Min(0)
  intervalMinutes?: number;

  /** Create draft articles for titles that are not found on the site */
  @IsOptional()
  @IsBoolean()
  createMissing?: boolean;
}

export class SpeedControlDto {
  @IsNumber()
  @Min(0)
  @Max(600000)
  delayMs: number;
}
