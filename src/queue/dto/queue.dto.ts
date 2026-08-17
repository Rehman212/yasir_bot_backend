import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsDateString,
  Min,
  Max,
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
}

export class SpeedControlDto {
  @IsNumber()
  @Min(0)
  @Max(600000)
  delayMs: number;
}
