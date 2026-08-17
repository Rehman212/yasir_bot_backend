import { IsString, IsUrl, MinLength, MaxLength, IsOptional } from 'class-validator';

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  applicationPassword?: string;
}
