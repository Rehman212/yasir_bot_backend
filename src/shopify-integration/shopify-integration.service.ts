import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { WordPressSitesService } from '../wordpress-sites/wordpress-sites.service';

const SHOPIFY_API_VERSION = '2024-10';

export type ShopifyArticleInput = {
  title: string;
  bodyHtml: string;
  summaryHtml?: string;
  handle?: string;
  tags?: string[];
  imageSrc?: string;
  published?: boolean;
};

@Injectable()
export class ShopifyIntegrationService {
  private readonly logger = new Logger(ShopifyIntegrationService.name);

  constructor(private readonly sites: WordPressSitesService) {}

  async createArticle(
    siteId: string,
    input: ShopifyArticleInput,
    userId?: string,
  ) {
    const { client, blogId, storeDomain } = await this.clientFor(
      siteId,
      userId,
    );
    if (!blogId) {
      throw new BadRequestException(
        'Shopify site has no blog selected. Edit the site and set a Blog ID.',
      );
    }

    const article: Record<string, unknown> = {
      title: input.title,
      body_html: input.bodyHtml,
      published: input.published !== false,
    };
    if (input.summaryHtml) article.summary_html = input.summaryHtml;
    if (input.handle) article.handle = input.handle;
    if (input.tags?.length) article.tags = input.tags.join(', ');
    if (input.imageSrc) article.image = { src: input.imageSrc };

    const res = await client.post(`/blogs/${blogId}/articles.json`, {
      article,
    });
    if (res.status >= 400) {
      const msg =
        typeof res.data?.errors === 'string'
          ? res.data.errors
          : JSON.stringify(res.data?.errors || res.data);
      throw new BadRequestException(`Shopify article create failed: ${msg}`);
    }
    const created = res.data?.article;
    if (!created?.id) {
      throw new BadRequestException('Shopify did not return an article id');
    }

    const link =
      created.url ||
      created.online_store_url ||
      `https://${storeDomain}/blogs/news/${created.handle || created.id}`;

    this.logger.log(`Shopify article created ${created.id} on ${storeDomain}`);
    return {
      data: {
        id: created.id,
        link,
        handle: created.handle,
        blog_id: created.blog_id,
      },
    };
  }

  async updateArticle(
    siteId: string,
    articleId: string,
    input: ShopifyArticleInput,
    userId?: string,
  ) {
    const { client, blogId, storeDomain } = await this.clientFor(
      siteId,
      userId,
    );
    if (!blogId) {
      throw new BadRequestException('Shopify site has no blog selected.');
    }

    const article: Record<string, unknown> = {
      id: articleId,
      title: input.title,
      body_html: input.bodyHtml,
      published: input.published !== false,
    };
    if (input.summaryHtml) article.summary_html = input.summaryHtml;
    if (input.handle) article.handle = input.handle;
    if (input.tags?.length) article.tags = input.tags.join(', ');
    if (input.imageSrc) article.image = { src: input.imageSrc };

    const res = await client.put(
      `/blogs/${blogId}/articles/${articleId}.json`,
      { article },
    );
    const updated = res.data?.article;
    const link =
      updated?.url ||
      updated?.online_store_url ||
      `https://${storeDomain}/blogs/news/${updated?.handle || articleId}`;

    return {
      data: {
        id: updated?.id || articleId,
        link,
        handle: updated?.handle,
        blog_id: updated?.blog_id || blogId,
      },
    };
  }

  private async clientFor(siteId: string, userId?: string) {
    const creds = await this.sites.getShopifyCredentials(siteId, userId);
    const client: AxiosInstance = axios.create({
      baseURL: `https://${creds.storeDomain}/admin/api/${SHOPIFY_API_VERSION}`,
      headers: {
        'X-Shopify-Access-Token': creds.accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: (s) => s < 500,
    });
    return {
      client,
      blogId: creds.blogId,
      storeDomain: creds.storeDomain,
    };
  }
}
