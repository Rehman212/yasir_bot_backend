import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ArticleStatus } from '../common/enums';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { ArticleQueryDto } from './dto/article-query.dto';

@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateArticleDto) {
    const site = await this.prisma.wordPressSite.findFirst({
      where: { id: dto.siteId, userId },
    });
    if (!site) throw new NotFoundException('Site not found');

    const duplicate = await this.findDuplicate(userId, dto.siteId, dto.title);
    const article = await this.prisma.article.create({
      data: {
        userId,
        siteId: dto.siteId,
        title: dto.title,
        content: dto.content,
        excerpt: dto.excerpt,
        slug: dto.slug,
        status: dto.status || ArticleStatus.DRAFT,
        category: dto.category,
        tags: dto.tags || [],
        featuredImageUrl: dto.featuredImageUrl,
        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
        focusKeyword: dto.focusKeyword,
        lsiKeywords: dto.lsiKeywords,
        publishAt: dto.publishAt ? new Date(dto.publishAt) : null,
        duplicateOfId: duplicate?.id || null,
      },
    });

    return { data: article, duplicateDetected: !!duplicate };
  }

  async findAll(userId: string, query: ArticleQueryDto) {
    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10) || 20));
    const where: Prisma.ArticleWhereInput = { userId };

    if (query.siteId) where.siteId = query.siteId;
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [items, total] = await Promise.all([
      this.prisma.article.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { site: { select: { id: true, name: true, url: true } } },
      }),
      this.prisma.article.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }

  async findOne(userId: string, id: string) {
    const article = await this.prisma.article.findUnique({
      where: { id },
      include: { site: { select: { id: true, name: true, url: true } } },
    });
    if (!article) throw new NotFoundException('Article not found');
    if (article.userId !== userId) throw new ForbiddenException('Access denied');
    return { data: article };
  }

  async update(userId: string, id: string, dto: UpdateArticleDto) {
    await this.getOwned(userId, id);
    const article = await this.prisma.article.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.excerpt !== undefined && { excerpt: dto.excerpt }),
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.featuredImageUrl !== undefined && {
          featuredImageUrl: dto.featuredImageUrl,
        }),
        ...(dto.seoTitle !== undefined && { seoTitle: dto.seoTitle }),
        ...(dto.seoDescription !== undefined && {
          seoDescription: dto.seoDescription,
        }),
        ...(dto.focusKeyword !== undefined && {
          focusKeyword: dto.focusKeyword,
        }),
        ...(dto.lsiKeywords !== undefined && {
          lsiKeywords: dto.lsiKeywords,
        }),
        ...(dto.publishAt !== undefined && {
          publishAt: dto.publishAt ? new Date(dto.publishAt) : null,
        }),
      },
    });
    return { data: article };
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.prisma.article.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  async detectDuplicates(userId: string, siteId?: string) {
    const where: Prisma.ArticleWhereInput = { userId };
    if (siteId) where.siteId = siteId;

    const articles = await this.prisma.article.findMany({
      where,
      select: { id: true, title: true, siteId: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const seen = new Map<string, string>();
    const duplicates: Array<{ id: string; title: string; duplicateOfId: string }> =
      [];

    for (const a of articles) {
      const key = `${a.siteId}::${a.title.trim().toLowerCase()}`;
      if (seen.has(key)) {
        duplicates.push({
          id: a.id,
          title: a.title,
          duplicateOfId: seen.get(key)!,
        });
      } else {
        seen.set(key, a.id);
      }
    }

    return { data: duplicates };
  }

  private async findDuplicate(
    userId: string,
    siteId: string,
    title: string,
  ) {
    return this.prisma.article.findFirst({
      where: {
        userId,
        siteId,
        title: { equals: title, mode: 'insensitive' },
      },
    });
  }

  private async getOwned(userId: string, id: string) {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) throw new NotFoundException('Article not found');
    if (article.userId !== userId) throw new ForbiddenException('Access denied');
    return article;
  }
}
