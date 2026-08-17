import { IsString, IsUrl, MinLength, MaxLength, IsOptional } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsUrl({ require_protocol: true })
  url: string;

  @IsString()
  @MinLength(1)
  username: string;

  @IsString()
  @MinLength(1)
  applicationPassword: string;
}
