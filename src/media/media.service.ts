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

const MAX_LIBRARY_IMAGES = 50;
const MAX_BYTES = 100 * 1024; // 100KB
export const MAX_BATCH_UPLOAD = 10;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wp: WordPressIntegrationService,
  ) {}

  async uploadFromUrl(
    userId: string,
    dto: UploadFromUrlDto,
    opts?: { enforceLimits?: boolean },
  ) {
    this.validateUrl(dto.sourceUrl);
    const enforceLimits = opts?.enforceLimits !== false;

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
        maxContentLength: enforceLimits ? MAX_BYTES : 15 * 1024 * 1024,
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

    filename = this.ensureImageFilename(filename, contentType);

    return this.saveAndUploadToWp(
      userId,
      dto.siteId,
      dto.sourceUrl,
      buffer,
      filename,
      contentType,
      { enforceLimits },
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
      (file.originalname || 'upload.webp').replace(/[^\w.\-]+/g, '_'),
      file.mimetype || 'image/webp',
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
      { enforceLimits: true },
    );
  }

  private async saveAndUploadToWp(
    userId: string,
    siteId: string,
    sourceUrl: string,
    buffer: Buffer,
    filename: string,
    contentType: string,
    opts: { enforceLimits: boolean },
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

    if (opts.enforceLimits) {
      this.assertWebpAndSize(buffer, filename, contentType);
      await this.assertUnderQuota(userId, existing?.id);
    }

    const asset =
      existing ||
      (await this.prisma.mediaAsset.create({
        data: {
          userId,
          siteId,
          sourceUrl,
          filename,
          contentHash,
          status: MediaStatus.PENDING,
          sizeBytes: buffer.length,
        },
      }));

    if (existing) {
      await this.prisma.mediaAsset.update({
        where: { id: existing.id },
        data: {
          status: MediaStatus.PENDING,
          sizeBytes: buffer.length,
          error: null,
        },
      });
    }

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
    const used = await this.prisma.mediaAsset.count({
      where: {
        userId,
        status: { in: [MediaStatus.UPLOADED, MediaStatus.PENDING, MediaStatus.LINKED] },
      },
    });
    return {
      data: assets,
      meta: {
        used,
        limit: MAX_LIBRARY_IMAGES,
        maxBytes: MAX_BYTES,
        format: 'image/webp',
      },
    };
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
    const asset = await this.getOwned(userId, id);
    if (asset.wpMediaId) {
      try {
        await this.wp.deleteMedia(asset.siteId, asset.wpMediaId, userId);
      } catch (err) {
        this.logger.warn(
          `WordPress media delete failed for ${id}: ${err?.message || err}`,
        );
      }
    }
    await this.prisma.mediaAsset.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  async removeMany(userId: string, ids: string[]) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (!unique.length) {
      throw new BadRequestException('No media ids provided');
    }
    let deleted = 0;
    const errors: Array<{ id: string; message: string }> = [];
    for (const id of unique) {
      try {
        await this.remove(userId, id);
        deleted += 1;
      } catch (err) {
        errors.push({
          id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { data: { deleted, failed: errors.length, errors } };
  }

  private assertWebpAndSize(
    buffer: Buffer,
    filename: string,
    contentType: string,
  ) {
    const mime = (contentType || '').toLowerCase();
    const isWebp =
      mime.includes('webp') || filename.toLowerCase().endsWith('.webp');
    if (!isWebp) {
      throw new BadRequestException(
        'Only WebP images are allowed in the media library (.webp, image/webp).',
      );
    }
    if (buffer.length > MAX_BYTES) {
      throw new BadRequestException(
        `Image must be under 100KB (got ${Math.ceil(buffer.length / 1024)}KB).`,
      );
    }
  }

  private async assertUnderQuota(userId: string, excludeId?: string) {
    const used = await this.prisma.mediaAsset.count({
      where: {
        userId,
        status: {
          in: [MediaStatus.UPLOADED, MediaStatus.PENDING, MediaStatus.LINKED],
        },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (used >= MAX_LIBRARY_IMAGES) {
      throw new BadRequestException(
        `Media limit reached (${MAX_LIBRARY_IMAGES}). Delete an image first to free space.`,
      );
    }
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
