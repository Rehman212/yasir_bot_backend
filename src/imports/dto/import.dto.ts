import {
  IsString,
  IsOptional,
  IsObject,
  IsUrl,
} from 'class-validator';

export class ColumnMappingDto {
  @IsObject()
  mapping: Record<string, string>;
}

export class GoogleSheetsImportDto {
  @IsUrl()
  sheetUrl: string;

  @IsString()
  siteId: string;

  @IsOptional()
  @IsObject()
  columnMapping?: Record<string, string>;
}

export class ValidateImportDto {
  @IsString()
  batchId: string;

  @IsOptional()
  @IsObject()
  columnMapping?: Record<string, string>;
}
