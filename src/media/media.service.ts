import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WordPressIntegrationService } from '../wordpress-integration/wordpress-integration.service';
import { MediaStatus } from '../common/enums';
import { UploadFromUrlDto } from './dto/upload-from-url.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wp: WordPressIntegrationService,
  ) {}

  async uploadFromUrl(userId: string, dto: UploadFromUrlDto) {
    this.validateUrl(dto.sourceUrl);

    const site = await this.prisma.wordPressSite.findFirst({
      where: { id: dto.siteId, userId },
    });
    if (!site) throw new NotFoundException('Site not found');

    let buffer: Buffer;
    let contentType = 'image/jpeg';
    let filename =
      dto.filename ||
      dto.sourceUrl.split('/').pop()?.split('?')[0] ||
      'image.jpg';

    try {
      const res = await axios.get(dto.sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 15 * 1024 * 1024,
      });
      buffer = Buffer.from(res.data);
      const headerType = res.headers['content-type'];
      contentType =
        typeof headerType === 'string' ? headerType : contentType;
    } catch (err) {
      throw new BadRequestException(`Failed to download image: ${err.message}`);
    }

    const contentHash = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.prisma.mediaAsset.findFirst({
      where: { userId, siteId: dto.siteId, contentHash },
    });

    if (existing?.wpMediaId && existing.status === MediaStatus.UPLOADED) {
      return {
        data: existing,
        deduplicated: true,
      };
    }

    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        siteId: dto.siteId,
        sourceUrl: dto.sourceUrl,
        filename,
        contentHash,
        status: MediaStatus.PENDING,
        sizeBytes: buffer.length,
      },
    });

    try {
      const uploaded = await this.wp.uploadImage(
        dto.siteId,
        buffer,
        filename,
        contentType,
        userId,
      );
      const updated = await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          wpMediaId: uploaded!.data.id,
          status: MediaStatus.UPLOADED,
          error: null,
        },
      });
      return { data: updated, deduplicated: false };
    } catch (err) {
      const failed = await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaStatus.FAILED,
          error: err.message,
        },
      });
      throw new BadRequestException({
        message: 'Media upload to WordPress failed',
        data: failed,
      });
    }
  }

  async findAll(userId: string, siteId?: string) {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { userId, ...(siteId && { siteId }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: assets };
  }

  async findOne(userId: string, id: string) {
    const asset = await this.getOwned(userId, id);
    return { data: asset };
  }

  async retry(userId: string, id: string) {
    const asset = await this.getOwned(userId, id);
    if (!asset.sourceUrl) {
      throw new BadRequestException('No source URL to retry');
    }
    return this.uploadFromUrl(userId, {
      siteId: asset.siteId,
      sourceUrl: asset.sourceUrl,
      filename: asset.filename || undefined,
    });
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.prisma.mediaAsset.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  private validateUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('Only HTTP(S) URLs are allowed');
    }
  }

  private async getOwned(userId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Media asset not found');
    if (asset.userId !== userId) throw new ForbiddenException('Access denied');
    return asset;
  }
}
