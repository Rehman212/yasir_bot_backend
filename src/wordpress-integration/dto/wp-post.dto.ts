import {
  IsString,
  IsOptional,
  IsArray,
  IsNumber,
  IsIn,
  MaxLength,
} from 'class-validator';

export class CreatePostDto {
  @IsString()
  @MaxLength(500)
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsIn(['draft', 'publish', 'future', 'private'])
  status?: string;

  @IsOptional()
  @IsArray()
  categories?: number[];

  @IsOptional()
  @IsArray()
  tags?: number[];

  @IsOptional()
  @IsNumber()
  featured_media?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  meta?: Record<string, unknown>;
}

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsIn(['draft', 'publish', 'future', 'private'])
  status?: string;

  @IsOptional()
  @IsArray()
  categories?: number[];

  @IsOptional()
  @IsArray()
  tags?: number[];

  @IsOptional()
  @IsNumber()
  featured_media?: number;

  @IsOptional()
  meta?: Record<string, unknown>;
}

export class CreateTaxonomyDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
