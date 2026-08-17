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
    filename =
      decodeURIComponent(filename).replace(/[^\w.\-]+/g, '_') || 'image';

    try {
      const res = await axios.get(dto.sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 45000,
        maxContentLength: 15 * 1024 * 1024,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; SheetPress/1.0; +https://localhost)',
          Accept: 'image/*,*/*',
        },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      buffer = Buffer.from(res.data);
      const headerType = res.headers['content-type'];
      contentType =
        typeof headerType === 'string'
          ? headerType.split(';')[0].trim()
          : contentType;
      if (!contentType.startsWith('image/')) {
        contentType = this.guessMimeFromFilename(filename);
      }
    } catch (err) {
      throw new BadRequestException(
        `Failed to download image URL. Use a direct public image link (https://...), not a Google Drive/view page. ${err.message}`,
      );
    }

    // WordPress rejects uploads without a known extension (Unsplash IDs have none)
    filename = this.ensureImageFilename(filename, contentType);

    return this.saveAndUploadToWp(
      userId,
      dto.siteId,
      dto.sourceUrl,
      buffer,
      filename,
      contentType,
    );
  }

  async uploadFile(
    userId: string,
    siteId: string,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required');
    }
    const site = await this.prisma.wordPressSite.findFirst({
      where: { id: siteId, userId },
    });
    if (!site) throw new NotFoundException('Site not found');

    const filename = this.ensureImageFilename(
      (file.originalname || 'upload.jpg').replace(/[^\w.\-]+/g, '_'),
      file.mimetype || 'image/jpeg',
    );
    const contentType = file.mimetype || this.guessMimeFromFilename(filename);
    const sourceUrl = `local://${filename}`;

    return this.saveAndUploadToWp(
      userId,
      siteId,
      sourceUrl,
      file.buffer,
      filename,
      contentType,
    );
  }

  private async saveAndUploadToWp(
    userId: string,
    siteId: string,
    sourceUrl: string,
    buffer: Buffer,
    filename: string,
    contentType: string,
  ) {
    const contentHash = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.prisma.mediaAsset.findFirst({
      where: { userId, siteId, contentHash },
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
        siteId,
        sourceUrl,
        filename,
        contentHash,
        status: MediaStatus.PENDING,
        sizeBytes: buffer.length,
      },
    });

    try {
      const uploaded = await this.wp.uploadImage(
        siteId,
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
          sourceUrl: uploaded!.data.source_url || sourceUrl,
        },
      });
      return { data: updated, deduplicated: false };
    } catch (err) {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          status: MediaStatus.FAILED,
          error: err.message,
        },
      });
      throw new BadRequestException(
        `Media upload to WordPress failed: ${err.message}`,
      );
    }
  }

  async findAll(userId: string, siteId?: string) {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { userId, ...(siteId && { siteId }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { site: { select: { id: true, name: true } } },
    });
    return { data: assets };
  }

  async findOne(userId: string, id: string) {
    const asset = await this.getOwned(userId, id);
    return { data: asset };
  }

  async retry(userId: string, id: string) {
    const asset = await this.getOwned(userId, id);
    if (!asset.sourceUrl || asset.sourceUrl.startsWith('local://')) {
      throw new BadRequestException(
        'Cannot retry local uploads without the original file. Upload again.',
      );
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

  private guessMimeFromFilename(filename: string) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.jpeg') || lower.endsWith('.jpg')) return 'image/jpeg';
    return 'image/jpeg';
  }

  private ensureImageFilename(filename: string, contentType: string) {
    const base = (filename || 'image').replace(/[^\w.\-]+/g, '_') || 'image';
    const hasExt = /\.(jpe?g|png|gif|webp)$/i.test(base);
    if (hasExt) return base;

    const mime = (contentType || '').toLowerCase();
    let ext = 'jpg';
    if (mime.includes('png')) ext = 'png';
    else if (mime.includes('webp')) ext = 'webp';
    else if (mime.includes('gif')) ext = 'gif';
    else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';

    return `${base}.${ext}`;
  }

  private async getOwned(userId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Media asset not found');
    if (asset.userId !== userId) throw new ForbiddenException('Access denied');
    return asset;
  }
}
