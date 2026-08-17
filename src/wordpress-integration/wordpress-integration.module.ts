import { Module } from '@nestjs/common';
import { WordPressIntegrationService } from './wordpress-integration.service';
import { WordPressIntegrationController } from './wordpress-integration.controller';
import { WordPressSitesModule } from '../wordpress-sites/wordpress-sites.module';

@Module({
  imports: [WordPressSitesModule],
  controllers: [WordPressIntegrationController],
  providers: [WordPressIntegrationService],
  exports: [WordPressIntegrationService],
})
export class WordPressIntegrationModule {}
