import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SeoService } from './seo.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateSeoDto } from './dto/update-seo.dto';

@Controller('seo')
@UseGuards(JwtAuthGuard)
export class SeoController {
  constructor(private readonly seoService: SeoService) {}

  @Patch()
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateSeoDto) {
    return this.seoService.updateArticleSeo(userId, dto);
  }

  @Get(':articleId/preview')
  preview(
    @CurrentUser('id') userId: string,
    @Param('articleId') articleId: string,
  ) {
    return this.seoService.previewMeta(userId, articleId);
  }
}
