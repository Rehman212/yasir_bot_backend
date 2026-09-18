import { Module } from '@nestjs/common';
import { ShopifyIntegrationService } from './shopify-integration.service';
import { WordPressSitesModule } from '../wordpress-sites/wordpress-sites.module';

@Module({
  imports: [WordPressSitesModule],
  providers: [ShopifyIntegrationService],
  exports: [ShopifyIntegrationService],
})
export class ShopifyIntegrationModule {}
