import { Module, forwardRef } from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { PublishingController } from './publishing.controller';
import { WordPressIntegrationModule } from '../wordpress-integration/wordpress-integration.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { MediaModule } from '../media/media.module';
import { SeoModule } from '../seo/seo.module';
import { TemplatesModule } from '../templates/templates.module';

@Module({
  imports: [
    WordPressIntegrationModule,
    TaxonomyModule,
    MediaModule,
    forwardRef(() => SeoModule),
    TemplatesModule,
  ],
  controllers: [PublishingController],
  providers: [PublishingService],
  exports: [PublishingService],
})
export class PublishingModule {}
