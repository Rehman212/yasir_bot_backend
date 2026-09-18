import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WordPressIntegrationService } from '../wordpress-integration/wordpress-integration.service';
import { ShopifyIntegrationService } from '../shopify-integration/shopify-integration.service';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { MediaService } from '../media/media.service';
import { SeoService } from '../seo/seo.service';
import { TemplatesService } from '../templates/templates.service';
import {
  ArticleStatus,
  NotificationType,
  SitePlatform,
} from '../common/enums';

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wp: WordPressIntegrationService,
    private readonly shopify: ShopifyIntegrationService,
    private readonly taxonomy: TaxonomyService,
    private readonly media: MediaService,
    private readonly seo: SeoService,
    private readonly templates: TemplatesService,
  ) {}

  async preparePayload(userId: string, articleId: string) {
    const article = await this.getOwnedArticle(userId, articleId);
    const site = await this.prisma.wordPressSite.findUnique({
      where: { id: article.siteId },
    });
    if (!site) throw new NotFoundException('Site not found');

    const template = await this.templates.resolveForArticle(
      userId,
      article.siteId,
      article.templateId,
    );
    const content = this.templates.applyToContent(article.content, template);

    if (site.platform === SitePlatform.SHOPIFY) {
      let featuredImageError: string | undefined;
      const imageUrl = article.featuredImageUrl?.trim();
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
        featuredImageError = `Featured image must be a full http(s) URL, got: ${imageUrl}`;
      }

      return {
        platform: SitePlatform.SHOPIFY as const,
        title: article.title,
        content,
        excerpt: article.excerpt || undefined,
        slug: article.slug || undefined,
        tags: article.tags || [],
        imageSrc:
          imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : undefined,
        article,
        site,
        featuredImageError,
        templateName: template?.name,
        categories: [] as number[],
        featured_media: undefined as number | undefined,
        meta: {},
      };
    }

    const category = article.category || template?.category || undefined;
    const tags =
      article.tags?.length > 0
        ? article.tags
        : template?.tags?.length
          ? template.tags
          : [];

    const { categoryIds, tagIds } = await this.taxonomy.ensureTermsForArticle(
      userId,
      article.siteId,
      category,
      tags,
    );

    let featuredMedia: number | undefined;
    let featuredImageError: string | undefined;
    if (article.featuredImageUrl) {
      const imageUrl = article.featuredImageUrl.trim();
      if (!/^https?:\/\//i.test(imageUrl)) {
        featuredImageError = `Featured image must be a full http(s) URL, got: ${imageUrl}`;
        this.logger.warn(featuredImageError);
      } else {
        try {
          const uploaded = await this.media.uploadFromUrl(
            userId,
            {
              siteId: article.siteId,
              sourceUrl: imageUrl,
            },
            { enforceLimits: false },
          );
          if (uploaded.data.wpMediaId) {
            featuredMedia = uploaded.data.wpMediaId;
          } else {
            featuredImageError =
              'Image uploaded but WordPress returned no media ID';
          }
        } catch (err) {
          featuredImageError =
            err?.response?.message ||
            err?.message ||
            'Featured image upload failed';
          this.logger.warn(
            `Featured image upload failed for ${articleId}: ${featuredImageError}`,
          );
        }
      }
    }

    const meta = this.seo.buildWpMeta({
      seoTitle: article.seoTitle,
      seoDescription: article.seoDescription,
      focusKeyword: article.focusKeyword,
      lsiKeywords: article.lsiKeywords,
      plugin: 'both',
    });

    return {
      platform: SitePlatform.WORDPRESS as const,
      title: article.title,
      content,
      excerpt: article.excerpt || undefined,
      slug: article.slug || undefined,
      categories: categoryIds,
      tags: tagIds,
      featured_media: featuredMedia,
      meta,
      article,
      site,
      featuredImageError,
      templateName: template?.name,
      imageSrc: undefined as string | undefined,
    };
  }

  async createDraft(userId: string, articleId: string) {
    const payload = await this.preparePayload(userId, articleId);
    this.assertNotAlreadyPublished(payload.article);

    if (payload.platform === SitePlatform.SHOPIFY) {
      const result = await this.shopify.createArticle(
        payload.article.siteId,
        {
          title: payload.title,
          bodyHtml: payload.content,
          summaryHtml: payload.excerpt,
          handle: payload.slug,
          tags: payload.tags as string[],
          imageSrc: payload.imageSrc,
          published: false,
        },
        userId,
      );
      const warning = payload.featuredImageError || undefined;
      const updated = await this.prisma.article.update({
        where: { id: articleId },
        data: {
          externalPostId: String(result.data.id),
          wpUrl: result.data.link,
          status: ArticleStatus.DRAFT,
          errorMessage: warning || null,
        },
      });
      return { data: updated, shopify: result.data, warning };
    }

    const result = await this.wp.createPost(
      payload.article.siteId,
      {
        title: payload.title,
        content: payload.content,
        excerpt: payload.excerpt,
        slug: payload.slug,
        status: 'draft',
        categories: payload.categories,
        tags: payload.tags as number[],
        featured_media: payload.featured_media,
        meta: payload.meta,
      },
      userId,
    );

    const seoWarning = (result as any)?.data?.seoWarning as
      | string
      | undefined;
    const warning =
      [payload.featuredImageError, seoWarning].filter(Boolean).join(' | ') ||
      undefined;

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        wpPostId: Number(result!.data.id),
        wpUrl: result!.data.link,
        status: ArticleStatus.DRAFT,
        errorMessage: warning || null,
      },
    });

    return {
      data: updated,
      wp: result!.data,
      warning,
      seoWarning,
    };
  }

  async publish(userId: string, articleId: string, asDraft = false) {
    const article = await this.getOwnedArticle(userId, articleId);
    this.assertNotAlreadyPublished(article);

    if (asDraft) {
      return this.createDraft(userId, articleId);
    }

    const payload = await this.preparePayload(userId, articleId);

    if (payload.platform === SitePlatform.SHOPIFY) {
      let result;
      if (article.externalPostId) {
        result = await this.shopify.updateArticle(
          article.siteId,
          article.externalPostId,
          {
            title: payload.title,
            bodyHtml: payload.content,
            summaryHtml: payload.excerpt,
            handle: payload.slug,
            tags: payload.tags as string[],
            imageSrc: payload.imageSrc,
            published: true,
          },
          userId,
        );
      } else {
        result = await this.shopify.createArticle(
          article.siteId,
          {
            title: payload.title,
            bodyHtml: payload.content,
            summaryHtml: payload.excerpt,
            handle: payload.slug,
            tags: payload.tags as string[],
            imageSrc: payload.imageSrc,
            published: true,
          },
          userId,
        );
      }

      const warning = payload.featuredImageError || undefined;
      await this.prisma.article.update({
        where: { id: articleId },
        data: {
          externalPostId: String(result.data.id),
          wpUrl: result.data.link,
          status: ArticleStatus.PUBLISHED,
          errorMessage: warning || null,
        },
      });

      await this.afterSuccessfulPublish(
        userId,
        articleId,
        article.title,
        article.siteId,
        result.data.link,
        String(result.data.id),
        warning,
      );

      return {
        data: { id: articleId, removedFromDb: true },
        shopify: result.data,
        warning,
        removedFromDb: true,
      };
    }

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
          tags: payload.tags as number[],
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
          tags: payload.tags as number[],
          featured_media: payload.featured_media,
          meta: payload.meta,
        },
        userId,
      );
    }

    const seoWarning = (result as any)?.data?.seoWarning as
      | string
      | undefined;
    const warning =
      [payload.featuredImageError, seoWarning].filter(Boolean).join(' | ') ||
      undefined;

    await this.prisma.article.update({
      where: { id: articleId },
      data: {
        wpPostId: Number(result!.data.id),
        wpUrl: result!.data.link,
        status: ArticleStatus.PUBLISHED,
        errorMessage: warning || null,
      },
    });

    await this.afterSuccessfulPublish(
      userId,
      articleId,
      article.title,
      article.siteId,
      result!.data.link,
      String(result!.data.id),
      warning,
    );

    return {
      data: { id: articleId, removedFromDb: true },
      wp: result!.data,
      warning,
      seoWarning,
      removedFromDb: true,
    };
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

    if (payload.platform === SitePlatform.SHOPIFY) {
      // Shopify: create unpublished; local scheduler / publishAt drives go-live
      const result = await this.shopify.createArticle(
        article.siteId,
        {
          title: payload.title,
          bodyHtml: payload.content,
          summaryHtml: payload.excerpt,
          handle: payload.slug,
          tags: payload.tags as string[],
          imageSrc: payload.imageSrc,
          published: false,
        },
        userId,
      );
      const updated = await this.prisma.article.update({
        where: { id: articleId },
        data: {
          externalPostId: String(result.data.id),
          wpUrl: result.data.link,
          status: ArticleStatus.SCHEDULED,
          publishAt: when,
          errorMessage: null,
        },
      });
      return { data: updated, shopify: result.data, timezone };
    }

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
        tags: payload.tags as number[],
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
    const payload = await this.preparePayload(userId, articleId);

    if (payload.platform === SitePlatform.SHOPIFY) {
      if (!article.externalPostId) {
        throw new BadRequestException(
          'Article has not been published to Shopify yet',
        );
      }
      const result = await this.shopify.updateArticle(
        article.siteId,
        article.externalPostId,
        {
          title: payload.title,
          bodyHtml: payload.content,
          summaryHtml: payload.excerpt,
          handle: payload.slug,
          tags: payload.tags as string[],
          imageSrc: payload.imageSrc,
          published: true,
        },
        userId,
      );
      const warning = payload.featuredImageError || undefined;
      const updated = await this.prisma.article.update({
        where: { id: articleId },
        data: {
          wpUrl: result.data.link,
          errorMessage: warning || null,
        },
      });
      return { data: updated, shopify: result.data, warning };
    }

    if (!article.wpPostId) {
      throw new BadRequestException('Article has not been published to WP yet');
    }

    const result = await this.wp.updatePost(
      article.siteId,
      article.wpPostId,
      {
        title: payload.title,
        content: payload.content,
        excerpt: payload.excerpt,
        slug: payload.slug,
        categories: payload.categories,
        tags: payload.tags as number[],
        featured_media: payload.featured_media,
        meta: payload.meta,
      },
      userId,
    );

    const seoWarning = (result as any)?.data?.seoWarning as
      | string
      | undefined;
    const warning =
      [payload.featuredImageError, seoWarning].filter(Boolean).join(' | ') ||
      undefined;

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        wpUrl: result!.data.link,
        errorMessage: warning || null,
      },
    });

    return {
      data: updated,
      wp: result!.data,
      warning,
      seoWarning,
    };
  }

  private async afterSuccessfulPublish(
    userId: string,
    articleId: string,
    title: string,
    siteId: string,
    remoteUrl: string,
    remoteId: string,
    warning?: string,
  ) {
    await this.prisma.wordPressSite.update({
      where: { id: siteId },
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
        message: warning
          ? `"${title}" published with warning: ${warning}`
          : `"${title}" was published successfully`,
        meta: {
          articleId,
          wpUrl: remoteUrl,
          remoteId,
        } as object,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'ARTICLE_PUBLISHED',
        entity: 'Article',
        entityId: articleId,
        metadata: {
          title,
          wpUrl: remoteUrl,
          siteId,
          remoteId,
        },
      },
    });

    await this.prisma.article.delete({ where: { id: articleId } });
    this.logger.log(
      `Published article ${articleId} removed from DB (kept on remote site)`,
    );
  }

  private assertNotAlreadyPublished(article: {
    status: string;
    wpPostId: number | null;
    externalPostId?: string | null;
  }) {
    if (
      article.status === ArticleStatus.PUBLISHED &&
      (article.wpPostId || article.externalPostId)
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
