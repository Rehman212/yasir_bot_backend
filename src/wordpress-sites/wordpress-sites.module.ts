import { Module } from '@nestjs/common';
import { WordPressSitesService } from './wordpress-sites.service';
import { WordPressSitesController } from './wordpress-sites.controller';

@Module({
  controllers: [WordPressSitesController],
  providers: [WordPressSitesService],
  exports: [WordPressSitesService],
})
export class WordPressSitesModule {}
