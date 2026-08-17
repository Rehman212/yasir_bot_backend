import {
  IsString,
  IsOptional,
  IsDateString,
  IsBoolean,
} from 'class-validator';

export class PublishArticleDto {
  @IsString()
  articleId: string;

  @IsOptional()
  @IsBoolean()
  asDraft?: boolean;
}

export class ScheduleArticleDto {
  @IsString()
  articleId: string;

  @IsDateString()
  publishAt: string;

  @IsOptional()
  @IsString()
  timezone?: string;
}

export class UpdatePublishedDto {
  @IsString()
  articleId: string;
}
