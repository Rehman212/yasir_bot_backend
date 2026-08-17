import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MediaService } from './media.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UploadFromUrlDto } from './dto/upload-from-url.dto';

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload-from-url')
  uploadFromUrl(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadFromUrlDto,
  ) {
    return this.mediaService.uploadFromUrl(userId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('id') userId: string,
    @Query('siteId') siteId?: string,
  ) {
    return this.mediaService.findAll(userId, siteId);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.mediaService.findOne(userId, id);
  }

  @Post(':id/retry')
  retry(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.mediaService.retry(userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.mediaService.remove(userId, id);
  }
}
