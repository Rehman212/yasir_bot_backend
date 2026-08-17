import { IsString, IsUrl, IsOptional } from 'class-validator';

export class UploadFromUrlDto {
  @IsString()
  siteId: string;

  @IsUrl({ require_protocol: true })
  sourceUrl: string;

  @IsOptional()
  @IsString()
  filename?: string;
}
