import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ArticleStatus,
  ImportSource,
  ImportStatus,
  NotificationType,
} from '../common/enums';

const DEFAULT_MAPPING: Record<string, string[]> = {
  title: ['title', 'Title', 'TITLE', 'post_title', 'headline'],
  content: ['content', 'Content', 'body', 'Body', 'post_content', 'html'],
  excerpt: ['excerpt', 'Excerpt', 'summary', 'Summary'],
  slug: ['slug', 'Slug', 'permalink'],
  category: ['category', 'Category', 'categories'],
  tags: ['tags', 'Tags', 'tag'],
  featuredImageUrl: [
    'featuredImageUrl',
    'featured_image',
    'Featured Image',
    'featured image',
    'image',
    'Image',
    'featuredImage',
  ],
  seoTitle: [
    'seoTitle',
    'seo_title',
    'SEO Title',
    'meta_title',
    'Meta Title',
  ],
  seoDescription: [
    'seoDescription',
    'seo_description',
    'Meta Description',
    'meta_description',
    'meta description',
  ],
  focusKeyword: [
    'focusKeyword',
    'focus_keyword',
    'Focus Keyword',
    'keyword',
  ],
  publishAt: [
    'publishAt',
    'publish_at',
    'Publish Date',
    'publish date',
    'scheduled_at',
    'date',
    'Date',
  ],
  postStatus: [
    'postStatus',
    'post_status',
    'Post Status',
    'status',
    'Status',
  ],
};

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly xlsx: typeof XLSX = (XLSX as any).default ?? XLSX;

  constructor(private readonly prisma: PrismaService) {}

  async uploadFile(
    userId: string,
    siteId: string,
    file: Express.Multer.File,
    columnMapping?: Record<string, string>,
  ) {
    try {
      if (!siteId?.trim()) {
        throw new BadRequestException('siteId is required');
      }
      if (!file?.buffer?.length) {
        throw new BadRequestException(
          'File is required. Upload a CSV or Excel (.xlsx) file.',
        );
      }

      const site = await this.prisma.wordPressSite.findFirst({
        where: { id: siteId, userId },
      });
      if (!site) throw new NotFoundException('Site not found');

      const ext = (file.originalname.split('.').pop() || '').toLowerCase();
      if (!['csv', 'xlsx', 'xls'].includes(ext)) {
        throw new BadRequestException(
          'Unsupported file type. Use CSV or Excel (.xlsx/.xls)',
        );
      }

      const source = ext === 'csv' ? ImportSource.CSV : ImportSource.EXCEL;

      let rows: Record<string, unknown>[];
      try {
        rows = this.parseFile(file, ext);
      } catch (err) {
        throw new BadRequestException(
          `Failed to parse file: ${err?.message || err}`,
        );
      }

      if (!rows.length) {
        throw new BadRequestException(
          'Spreadsheet has no data rows. Check the file and try again.',
        );
      }

      const mapping = columnMapping || this.autoMap(rows[0] || {});
      if (!mapping.title || !mapping.content) {
        throw new BadRequestException(
          `Could not find Title/Content columns. Found headers: ${Object.keys(rows[0] || {}).join(', ') || '(none)'}`,
        );
      }

      const { articles, errors } = this.mapRows(rows, mapping);

      const batch = await this.prisma.importBatch.create({
        data: {
          userId,
          siteId,
          filename: file.originalname,
          source,
          status:
            articles.length > 0
              ? ImportStatus.COMPLETED
              : ImportStatus.FAILED,
          columnMapping: mapping as Prisma.InputJsonValue,
          rowCount: rows.length,
          errorCount: errors.length,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });

      if (articles.length > 0) {
        await this.prisma.article.createMany({
          data: articles.map((a) => ({
            userId,
            siteId,
            importBatchId: batch.id,
            title: a.title,
            content: a.content,
            excerpt: a.excerpt || null,
            slug: a.slug || null,
            status: a.status || ArticleStatus.DRAFT,
            category: a.category || null,
            tags: a.tags || [],
            featuredImageUrl: a.featuredImageUrl || null,
            seoTitle: a.seoTitle || null,
            seoDescription: a.seoDescription || null,
            focusKeyword: a.focusKeyword || null,
            publishAt: a.publishAt || null,
          })),
        });
      }

      await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.IMPORT_COMPLETED,
          title: 'Import completed',
          message: `Imported ${articles.length} articles from ${file.originalname} (${errors.length} errors)`,
          meta: {
            batchId: batch.id,
            siteId,
          } as Prisma.InputJsonValue,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'IMPORT',
          entity: 'ImportBatch',
          entityId: batch.id,
          metadata: {
            filename: file.originalname,
            imported: articles.length,
            errors: errors.length,
            siteId,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        data: {
          batch,
          imported: articles.length,
          errors,
        },
      };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }
      this.logger.error(`Import upload failed: ${err?.message}`, err?.stack);
      throw new InternalServerErrorException(
        err?.message || 'Import failed unexpectedly',
      );
    }
  }

  async importGoogleSheets(
    userId: string,
    sheetUrl: string,
    siteId: string,
    columnMapping?: Record<string, string>,
  ) {
    const site = await this.prisma.wordPressSite.findFirst({
      where: { id: siteId, userId },
    });
    if (!site) throw new NotFoundException('Site not found');

    this.logger.warn(
      `Google Sheets import stub called for ${sheetUrl} — full OAuth/API integration pending`,
    );

    const mockRows = [
      {
        title: 'Sample from Google Sheets',
        content: '<p>Replace with real Sheets API read.</p>',
        category: 'Uncategorized',
      },
    ];

    const mapping = columnMapping || this.autoMap(mockRows[0]);
    const { articles, errors } = this.mapRows(mockRows, mapping);

    const batch = await this.prisma.importBatch.create({
      data: {
        userId,
        siteId,
        filename: sheetUrl,
        source: ImportSource.GOOGLE_SHEETS,
        status: ImportStatus.COMPLETED,
        columnMapping: mapping as Prisma.InputJsonValue,
        rowCount: mockRows.length,
        errorCount: errors.length,
        errors: errors as unknown as Prisma.InputJsonValue,
      },
    });

    if (articles.length > 0) {
      await this.prisma.article.createMany({
        data: articles.map((a) => ({
          userId,
          siteId,
          importBatchId: batch.id,
          title: a.title,
          content: a.content,
          status: ArticleStatus.DRAFT,
          category: a.category || null,
          tags: a.tags || [],
        })),
      });
    }

    return {
      data: {
        batch,
        imported: articles.length,
        errors,
        note: 'TODO: Wire Google Sheets API; currently returns mock sample row',
      },
    };
  }

  async history(userId: string) {
    const batches = await this.prisma.importBatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { data: batches };
  }

  async getBatch(userId: string, id: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('Import batch not found');
    if (batch.userId !== userId) throw new ForbiddenException('Access denied');
    return { data: batch };
  }

  async validateMapping(
    userId: string,
    batchId: string,
    columnMapping?: Record<string, string>,
  ) {
    const batch = await this.getBatch(userId, batchId);
    const mapping =
      columnMapping ||
      (batch.data.columnMapping as Record<string, string>) ||
      {};
    const missing = ['title', 'content'].filter((k) => !mapping[k]);
    return {
      data: {
        valid: missing.length === 0,
        missing,
        mapping,
      },
    };
  }

  private parseFile(
    file: Express.Multer.File,
    ext: string,
  ): Record<string, unknown>[] {
    if (ext === 'csv') {
      return parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
      }) as Record<string, unknown>[];
    }

    if (['xlsx', 'xls'].includes(ext)) {
      const workbook = this.xlsx.read(file.buffer, {
        type: 'buffer',
        cellDates: true,
      });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('Excel file has no sheets');
      const sheet = workbook.Sheets[sheetName];
      const rows = this.xlsx.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false,
      }) as Record<string, unknown>[];
      return rows.filter((row) =>
        Object.values(row).some((v) => String(v ?? '').trim() !== ''),
      );
    }

    throw new Error('Unsupported file type. Use CSV or Excel (.xlsx/.xls)');
  }

  private autoMap(sample: Record<string, unknown>): Record<string, string> {
    const headers = Object.keys(sample).map((h) => h.trim());
    const mapping: Record<string, string> = {};
    for (const [field, aliases] of Object.entries(DEFAULT_MAPPING)) {
      const hit = headers.find((h) =>
        aliases.some((a) => a.toLowerCase() === h.toLowerCase()),
      );
      if (hit) {
        // keep original header key from sample
        const original =
          Object.keys(sample).find((k) => k.trim() === hit) || hit;
        mapping[field] = original;
      }
    }
    return mapping;
  }

  private mapRows(
    rows: Record<string, unknown>[],
    mapping: Record<string, string>,
  ) {
    const articles: Array<{
      title: string;
      content: string;
      excerpt?: string;
      slug?: string;
      category?: string;
      tags?: string[];
      featuredImageUrl?: string;
      seoTitle?: string;
      seoDescription?: string;
      focusKeyword?: string;
      publishAt?: Date;
      status?: ArticleStatus;
    }> = [];
    const errors: Array<{ row: number; message: string }> = [];

    rows.forEach((row, idx) => {
      const get = (field: string) => {
        const col = mapping[field];
        if (!col) return '';
        const value = row[col] ?? row[col.trim()];
        if (value instanceof Date) return value.toISOString();
        return String(value ?? '').trim();
      };

      const title = get('title');
      const content = get('content');
      if (!title || !content) {
        errors.push({
          row: idx + 2,
          message: 'Missing required title or content',
        });
        return;
      }

      const tagsRaw = get('tags');
      let publishAt: Date | undefined;
      const dateRaw = get('publishAt');
      if (dateRaw) {
        const asNumber = Number(dateRaw);
        const d =
          !Number.isNaN(asNumber) && dateRaw.length <= 5
            ? this.excelSerialToDate(asNumber)
            : new Date(dateRaw);
        if (!isNaN(d.getTime())) publishAt = d;
      }

      const status = this.parsePostStatus(get('postStatus'), publishAt);

      articles.push({
        title,
        content,
        excerpt: get('excerpt') || undefined,
        slug: get('slug') || undefined,
        category: get('category') || undefined,
        tags: tagsRaw
          ? tagsRaw.split(/[,|;]/).map((t) => t.trim()).filter(Boolean)
          : [],
        featuredImageUrl: get('featuredImageUrl') || undefined,
        seoTitle: get('seoTitle') || undefined,
        seoDescription: get('seoDescription') || undefined,
        focusKeyword: get('focusKeyword') || undefined,
        publishAt,
        status,
      });
    });

    return { articles, errors };
  }

  private parsePostStatus(
    raw: string,
    publishAt?: Date,
  ): ArticleStatus {
    const value = raw.toLowerCase().trim();
    if (['publish', 'published', 'live'].includes(value)) {
      return ArticleStatus.PUBLISHED;
    }
    if (['schedule', 'scheduled', 'future'].includes(value)) {
      return ArticleStatus.SCHEDULED;
    }
    if (['queue', 'queued'].includes(value)) {
      return ArticleStatus.QUEUED;
    }
    if (publishAt && publishAt.getTime() > Date.now()) {
      return ArticleStatus.SCHEDULED;
    }
    return ArticleStatus.DRAFT;
  }

  private excelSerialToDate(serial: number) {
    // Excel epoch (with 1900 leap-year bug)
    const utc = Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000;
    return new Date(utc);
  }
}
