import {
  IsString,
  IsOptional,
  MaxLength,
  IsIn,
} from 'class-validator';

export class UpdateSeoDto {
  @IsString()
  articleId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  seoDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  focusKeyword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  lsiKeywords?: string;

  @IsOptional()
  @IsIn(['yoast', 'rankmath', 'both'])
  plugin?: 'yoast' | 'rankmath' | 'both';
}
