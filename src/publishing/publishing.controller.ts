import {
  Controller,
  Post,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PublishingService } from './publishing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  PublishArticleDto,
  ScheduleArticleDto,
  UpdatePublishedDto,
} from './dto/publish.dto';

@Controller('publishing')
@UseGuards(JwtAuthGuard)
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Post('prepare')
  prepare(
    @CurrentUser('id') userId: string,
    @Body() dto: PublishArticleDto,
  ) {
    return this.publishingService.preparePayload(userId, dto.articleId);
  }

  @Post('draft')
  createDraft(
    @CurrentUser('id') userId: string,
    @Body() dto: PublishArticleDto,
  ) {
    return this.publishingService.createDraft(userId, dto.articleId);
  }

  @Post('publish')
  publish(
    @CurrentUser('id') userId: string,
    @Body() dto: PublishArticleDto,
  ) {
    return this.publishingService.publish(userId, dto.articleId, dto.asDraft);
  }

  @Post('schedule')
  schedule(
    @CurrentUser('id') userId: string,
    @Body() dto: ScheduleArticleDto,
  ) {
    return this.publishingService.schedule(
      userId,
      dto.articleId,
      dto.publishAt,
      dto.timezone,
    );
  }

  @Post('update')
  updatePublished(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePublishedDto,
  ) {
    return this.publishingService.updatePublished(userId, dto.articleId);
  }
}
