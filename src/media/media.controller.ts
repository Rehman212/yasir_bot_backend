import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  uploadFile(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('siteId') siteIdQuery?: string,
    @Body('siteId') siteIdBody?: string,
  ) {
    const siteId = (siteIdQuery || siteIdBody || '').trim();
    if (!siteId) throw new BadRequestException('siteId is required');
    if (!file) throw new BadRequestException('file is required');
    return this.mediaService.uploadFile(userId, siteId, file);
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
