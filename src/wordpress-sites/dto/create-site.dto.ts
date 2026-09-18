import {
  IsString,
  IsUrl,
  MinLength,
  MaxLength,
  IsOptional,
  IsIn,
  ValidateIf,
} from 'class-validator';

export class CreateSiteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsIn(['WORDPRESS', 'SHOPIFY'])
  platform?: 'WORDPRESS' | 'SHOPIFY';

  // —— WordPress ——
  @ValidateIf((o) => (o.platform || 'WORDPRESS') === 'WORDPRESS')
  @IsUrl({ require_protocol: true })
  url?: string;

  @ValidateIf((o) => (o.platform || 'WORDPRESS') === 'WORDPRESS')
  @IsString()
  @MinLength(1)
  username?: string;

  @ValidateIf((o) => (o.platform || 'WORDPRESS') === 'WORDPRESS')
  @IsString()
  @MinLength(1)
  applicationPassword?: string;

  // —— Shopify ——
  /** my-store.myshopify.com or https://my-store.myshopify.com */
  @ValidateIf((o) => o.platform === 'SHOPIFY')
  @IsString()
  @MinLength(3)
  storeDomain?: string;

  @ValidateIf((o) => o.platform === 'SHOPIFY')
  @IsString()
  @MinLength(8)
  accessToken?: string;

  /** Optional — defaults to first blog on the shop */
  @IsOptional()
  @IsString()
  blogId?: string;
}
