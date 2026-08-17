import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WordPressIntegrationService } from '../wordpress-integration/wordpress-integration.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { MediaService } from '../media/media.service';
import { SeoService } from '../seo/seo.service';
import { ArticleStatus, NotificationType } from '../common/enums';

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wp: WordPressIntegrationService,
    private readonly taxonomy: TaxonomyService,
    private readonly media: MediaService,
    private readonly seo: SeoService,
  ) {}

  async preparePayload(userId: string, articleId: string) {
    const article = await this.getOwnedArticle(userId, articleId);
    const { categoryIds, tagIds } =
      await this.taxonomy.ensureTermsForArticle(
        userId,
        article.siteId,
        article.category,
        article.tags,
      );

    let featuredMedia: number | undefined;
    if (article.featuredImageUrl) {
      try {
        const uploaded = await this.media.uploadFromUrl(userId, {
          siteId: article.siteId,
          sourceUrl: article.featuredImageUrl,
        });
        if (uploaded.data.wpMediaId) {
          featuredMedia = uploaded.data.wpMediaId;
        }
      } catch (err) {
        this.logger.warn(
          `Featured image upload failed for ${articleId}: ${err.message}`,
        );
      }
    }

    const meta = this.seo.buildWpMeta({
      seoTitle: article.seoTitle,
      seoDescription: article.seoDescription,
      focusKeyword: article.focusKeyword,
    });

    return {
      title: article.title,
      content: article.content,
      excerpt: article.excerpt || undefined,
      slug: article.slug || undefined,
      categories: categoryIds,
      tags: tagIds,
      featured_media: featuredMedia,
      meta,
      article,
    };
  }

  async createDraft(userId: string, articleId: string) {
    const payload = await this.preparePayload(userId, articleId);
    this.assertNotAlreadyPublished(payload.article);

    const result = await this.wp.createPost(
      payload.article.siteId,
      {
        title: payload.title,
        content: payload.content,
        excerpt: payload.excerpt,
        slug: payload.slug,
        status: 'draft',
        categories: payload.categories,
        tags: payload.tags,
        featured_media: payload.featured_media,
        meta: payload.meta,
      },
      userId,
    );

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        wpPostId: Number(result!.data.id),
        wpUrl: result!.data.link,
        status: ArticleStatus.DRAFT,
        errorMessage: null,
      },
    });

    return { data: updated, wp: result!.data };
  }

  async publish(userId: string, articleId: string, asDraft = false) {
    const article = await this.getOwnedArticle(userId, articleId);
    this.assertNotAlreadyPublished(article);

    if (asDraft) {
      return this.createDraft(userId, articleId);
    }

    const payload = await this.preparePayload(userId, articleId);

    let result;
    if (article.wpPostId) {
      result = await this.wp.updatePost(
        article.siteId,
        article.wpPostId,
        {
          title: payload.title,
          content: payload.content,
          excerpt: payload.excerpt,
          slug: payload.slug,
          status: 'publish',
          categories: payload.categories,
          tags: payload.tags,
          featured_media: payload.featured_media,
          meta: payload.meta,
        },
        userId,
      );
    } else {
      result = await this.wp.createPost(
        article.siteId,
        {
          title: payload.title,
          content: payload.content,
          excerpt: payload.excerpt,
          slug: payload.slug,
          status: 'publish',
          categories: payload.categories,
          tags: payload.tags,
          featured_media: payload.featured_media,
          meta: payload.meta,
        },
        userId,
      );
    }

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        wpPostId: Number(result!.data.id),
        wpUrl: result!.data.link,
        status: ArticleStatus.PUBLISHED,
        errorMessage: null,
      },
    });

    await this.prisma.wordPressSite.update({
      where: { id: article.siteId },
      data: { publishedCount: { increment: 1 } },
    });

    await this.prisma.subscription.updateMany({
      where: { userId },
      data: { articlesUsed: { increment: 1 } },
    });

    await this.prisma.notification.create({
      data: {
        userId,
        type: NotificationType.PUBLISH_COMPLETED,
        title: 'Article published',
        message: `"${article.title}" was published successfully`,
        meta: { articleId, wpUrl: result!.data.link } as object,
      },
    });

    return { data: updated, wp: result!.data };
  }

  async schedule(
    userId: string,
    articleId: string,
    publishAt: string,
    timezone = 'UTC',
  ) {
    const article = await this.getOwnedArticle(userId, articleId);
    this.assertNotAlreadyPublished(article);

    const when = new Date(publishAt);
    if (isNaN(when.getTime()) || when <= new Date()) {
      throw new BadRequestException('publishAt must be a future date');
    }

    const payload = await this.preparePayload(userId, articleId);
    const result = await this.wp.createPost(
      article.siteId,
      {
        title: payload.title,
        content: payload.content,
        excerpt: payload.excerpt,
        slug: payload.slug,
        status: 'future',
        date: when.toISOString(),
        categories: payload.categories,
        tags: payload.tags,
        featured_media: payload.featured_media,
        meta: payload.meta,
      },
      userId,
    );

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        wpPostId: Number(result!.data.id),
        wpUrl: result!.data.link,
        status: ArticleStatus.SCHEDULED,
        publishAt: when,
        errorMessage: null,
      },
    });

    return { data: updated, wp: result!.data, timezone };
  }

  async updatePublished(userId: string, articleId: string) {
    const article = await this.getOwnedArticle(userId, articleId);
    if (!article.wpPostId) {
      throw new BadRequestException('Article has not been published to WP yet');
    }

    const payload = await this.preparePayload(userId, articleId);
    const result = await this.wp.updatePost(
      article.siteId,
      article.wpPostId,
      {
        title: payload.title,
        content: payload.content,
        excerpt: payload.excerpt,
        slug: payload.slug,
        categories: payload.categories,
        tags: payload.tags,
        featured_media: payload.featured_media,
        meta: payload.meta,
      },
      userId,
    );

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        wpUrl: result!.data.link,
        errorMessage: null,
      },
    });

    return { data: updated, wp: result!.data };
  }

  private assertNotAlreadyPublished(article: {
    status: string;
    wpPostId: number | null;
  }) {
    if (
      article.status === ArticleStatus.PUBLISHED &&
      article.wpPostId
    ) {
      throw new BadRequestException(
        'Article already published. Use update endpoint instead.',
      );
    }
  }

  private async getOwnedArticle(userId: string, id: string) {
    const article = await this.prisma.article.findUnique({ where: { id } });
    if (!article) throw new NotFoundException('Article not found');
    if (article.userId !== userId) throw new ForbiddenException('Access denied');
    return article;
  }
}
