import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { WordPressIntegrationModule } from '../wordpress-integration/wordpress-integration.module';

@Module({
  imports: [WordPressIntegrationModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
