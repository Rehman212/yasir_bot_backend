import { IsString, IsOptional, IsEnum } from 'class-validator';
import { TaxonomyType } from '../../common/enums';

export class SyncTaxonomyDto {
  @IsString()
  siteId: string;

  @IsOptional()
  @IsEnum(TaxonomyType)
  type?: TaxonomyType;
}

export class CreateTaxonomyTermDto {
  @IsString()
  siteId: string;

  @IsEnum(TaxonomyType)
  type: TaxonomyType;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;
}
