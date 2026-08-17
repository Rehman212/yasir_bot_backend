import {
  IsString,
  IsOptional,
  IsArray,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';

export class ScheduleBatchDto {
  @IsArray()
  @IsString({ each: true })
  articleIds: string[];

  @IsDateString()
  startAt: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  intervalMinutes?: number;
}

export class RecoverMissedDto {
  @IsOptional()
  @IsString()
  siteId?: string;
}
