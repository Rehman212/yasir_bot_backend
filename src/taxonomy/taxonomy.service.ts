import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WordPressIntegrationService } from '../wordpress-integration/wordpress-integration.service';
import { TaxonomyType } from '../common/enums';
import { CreateTaxonomyTermDto } from './dto/taxonomy.dto';

@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wp: WordPressIntegrationService,
  ) {}

  async sync(userId: string, siteId: string, type?: TaxonomyType) {
    await this.assertSite(userId, siteId);
    const synced: unknown[] = [];

    if (!type || type === TaxonomyType.CATEGORY) {
      const cats = await this.wp.fetchCategories(siteId, userId);
      for (const c of cats!.data as any[]) {
        const term = await this.prisma.taxonomyTerm.upsert({
          where: {
            siteId_type_slug: {
              siteId,
              type: TaxonomyType.CATEGORY,
              slug: c.slug,
            },
          },
          create: {
            siteId,
            type: TaxonomyType.CATEGORY,
            name: c.name,
            slug: c.slug,
            wpId: c.id,
          },
          update: { name: c.name, wpId: c.id },
        });
        synced.push(term);
      }
    }

    if (!type || type === TaxonomyType.TAG) {
      const tags = await this.wp.fetchTags(siteId, userId);
      for (const t of tags!.data as any[]) {
        const term = await this.prisma.taxonomyTerm.upsert({
          where: {
            siteId_type_slug: {
              siteId,
              type: TaxonomyType.TAG,
              slug: t.slug,
            },
          },
          create: {
            siteId,
            type: TaxonomyType.TAG,
            name: t.name,
            slug: t.slug,
            wpId: t.id,
          },
          update: { name: t.name, wpId: t.id },
        });
        synced.push(term);
      }
    }

    return { data: synced, count: synced.length };
  }

  async createMissing(userId: string, dto: CreateTaxonomyTermDto) {
    await this.assertSite(userId, dto.siteId);

    const existing = await this.prisma.taxonomyTerm.findFirst({
      where: {
        siteId: dto.siteId,
        type: dto.type,
        name: { equals: dto.name, mode: 'insensitive' },
      },
    });
    if (existing?.wpId) {
      return { data: existing, created: false };
    }

    const result =
      dto.type === TaxonomyType.CATEGORY
        ? await this.wp.createCategory(
            dto.siteId,
            { name: dto.name, slug: dto.slug },
            userId,
          )
        : await this.wp.createTag(
            dto.siteId,
            { name: dto.name, slug: dto.slug },
            userId,
          );

    const term = await this.prisma.taxonomyTerm.upsert({
      where: {
        siteId_type_slug: {
          siteId: dto.siteId,
          type: dto.type,
          slug: result!.data.slug,
        },
      },
      create: {
        siteId: dto.siteId,
        type: dto.type,
        name: result!.data.name,
        slug: result!.data.slug,
        wpId: result!.data.id,
      },
      update: {
        name: result!.data.name,
        wpId: result!.data.id,
      },
    });

    return { data: term, created: true };
  }

  async list(userId: string, siteId: string, type?: TaxonomyType) {
    await this.assertSite(userId, siteId);
    const terms = await this.prisma.taxonomyTerm.findMany({
      where: { siteId, ...(type && { type }) },
      orderBy: { name: 'asc' },
    });
    return { data: terms };
  }

  async ensureTermsForArticle(
    userId: string,
    siteId: string,
    category?: string | null,
    tags?: string[],
  ) {
    const categoryIds: number[] = [];
    const tagIds: number[] = [];

    if (category) {
      const result = await this.createMissing(userId, {
        siteId,
        type: TaxonomyType.CATEGORY,
        name: category,
      });
      if (result.data.wpId) categoryIds.push(result.data.wpId);
    }

    for (const tag of tags || []) {
      const result = await this.createMissing(userId, {
        siteId,
        type: TaxonomyType.TAG,
        name: tag,
      });
      if (result.data.wpId) tagIds.push(result.data.wpId);
    }

    return { categoryIds, tagIds };
  }

  private async assertSite(userId: string, siteId: string) {
    const site = await this.prisma.wordPressSite.findFirst({
      where: { id: siteId, userId },
    });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
}
