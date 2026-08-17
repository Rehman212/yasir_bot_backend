import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as FormDataImport from 'form-data';
import { WordPressSitesService } from '../wordpress-sites/wordpress-sites.service';

const FormData = (FormDataImport as any).default || FormDataImport;
import {
  CreatePostDto,
  UpdatePostDto,
  CreateTaxonomyDto,
} from './dto/wp-post.dto';

@Injectable()
export class WordPressIntegrationService {
  private readonly logger = new Logger(WordPressIntegrationService.name);

  constructor(private readonly sitesService: WordPressSitesService) {}

  private async client(siteId: string, userId?: string): Promise<{
    http: AxiosInstance;
    baseUrl: string;
  }> {
    const creds = await this.sitesService.getDecryptedCredentials(
      siteId,
      userId,
    );
    const http = axios.create({
      baseURL: `${creds.baseUrl}/wp-json/wp/v2`,
      auth: { username: creds.username, password: creds.password },
      timeout: 30000,
    });
    return { http, baseUrl: creds.baseUrl };
  }

  async createPost(siteId: string, dto: CreatePostDto, userId?: string) {
    const { http } = await this.client(siteId, userId);
    try {
      // Don't send SEO meta in the create body — Yoast private keys can
      // cause WP to ignore the whole meta object. Sync separately after.
      const res = await http.post('/posts', {
        title: dto.title,
        content: dto.content,
        excerpt: dto.excerpt,
        slug: dto.slug,
        status: dto.status || 'draft',
        categories: dto.categories,
        tags: dto.tags,
        featured_media: dto.featured_media,
        date: dto.date,
      });

      const postId = res.data.id as number;
      let seoWarning: string | undefined;
      if (dto.meta && Object.keys(dto.meta).length > 0) {
        seoWarning = await this.syncSeoMeta(siteId, postId, dto.meta, userId);
      }

      return {
        data: {
          id: postId,
          link: res.data.link,
          status: res.data.status,
          slug: res.data.slug,
          raw: res.data,
          seoWarning,
        },
      };
    } catch (err) {
      this.throwWpError('createPost', err);
    }
  }

  async updatePost(
    siteId: string,
    postId: number,
    dto: UpdatePostDto,
    userId?: string,
  ) {
    const { http } = await this.client(siteId, userId);
    try {
      const { meta, ...rest } = dto;
      const res = await http.post(`/posts/${postId}`, rest);

      let seoWarning: string | undefined;
      if (meta && Object.keys(meta).length > 0) {
        seoWarning = await this.syncSeoMeta(siteId, postId, meta, userId);
      }

      return {
        data: {
          id: res.data.id,
          link: res.data.link,
          status: res.data.status,
          raw: res.data,
          seoWarning,
        },
      };
    } catch (err) {
      this.throwWpError('updatePost', err);
    }
  }

  /**
   * Apply Rank Math / Yoast SEO.
   * Prefers SheetPress SEO Bridge plugin (update_post_meta), then REST meta fallback.
   */
  async syncSeoMeta(
    siteId: string,
    postId: number,
    meta: Record<string, unknown>,
    userId?: string,
  ): Promise<string | undefined> {
    const creds = await this.sitesService.getDecryptedCredentials(
      siteId,
      userId,
    );
    const { http, baseUrl } = await this.client(siteId, userId);

    const seoTitle = String(
      meta.rank_math_title || meta._yoast_wpseo_title || '',
    ).trim();
    const seoDescription = String(
      meta.rank_math_description || meta._yoast_wpseo_metadesc || '',
    ).trim();
    // Already combined (focus + LSI) by SeoService.buildWpMeta for Rank Math
    const focusKeyword = String(
      meta.rank_math_focus_keyword || meta._yoast_wpseo_focuskw || '',
    ).trim();

    if (!seoTitle && !seoDescription && !focusKeyword) {
      return 'No SEO fields on article (seoTitle / seoDescription / focusKeyword empty in SheetPress)';
    }

    // 1) Preferred: companion plugin writes meta the Rank Math UI can read
    try {
      const bridge = await axios.post(
        `${baseUrl}/wp-json/sheetpress/v1/seo/${postId}`,
        { seoTitle, seoDescription, focusKeyword },
        {
          auth: { username: creds.username, password: creds.password },
          timeout: 20000,
          validateStatus: (s) => s < 500,
        },
      );

      if (bridge.status >= 200 && bridge.status < 300 && bridge.data?.ok) {
        this.logger.log(
          `SEO synced via SheetPress bridge for post ${postId}: ${JSON.stringify(bridge.data.values)}`,
        );
        return undefined;
      }

      if (bridge.status === 404) {
        this.logger.warn(
          'SheetPress SEO Bridge plugin not installed — Rank Math will ignore REST meta',
        );
        return (
          'SheetPress SEO Bridge plugin is NOT installed on WordPress. ' +
          'Rank Math blocks SEO title / description / focus keyword over REST. ' +
          'Install Plugins → Add New → Upload → sheetpress-seo-bridge.zip, activate it, then click Update on WordPress again.'
        );
      }

      this.logger.warn(
        `SheetPress SEO Bridge returned ${bridge.status}: ${JSON.stringify(bridge.data)}`,
      );
      return `SheetPress SEO Bridge error (${bridge.status}). Install/activate the plugin, then retry Update on WordPress.`;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        return (
          'SheetPress SEO Bridge plugin is NOT installed on WordPress. ' +
          'Without it Rank Math Focus Keyword / SEO Title / Meta Description stay empty. ' +
          'Upload sheetpress-seo-bridge.zip in WP admin, activate, then Update on WordPress.'
        );
      }
      this.logger.warn(
        `SheetPress SEO Bridge unavailable: ${err.message} — trying REST meta fallback`,
      );
    }

    // 2) Fallback only if bridge is reachable but failed for another reason,
    // or network error. Rank Math usually still ignores this without register_meta.
    const warnings: string[] = [];
    const rankmath: Record<string, unknown> = {};
    const yoast: Record<string, unknown> = {};
    if (seoTitle) {
      rankmath.rank_math_title = seoTitle;
      yoast._yoast_wpseo_title = seoTitle;
    }
    if (seoDescription) {
      rankmath.rank_math_description = seoDescription;
      yoast._yoast_wpseo_metadesc = seoDescription;
    }
    if (focusKeyword) {
      rankmath.rank_math_focus_keyword = focusKeyword;
      yoast._yoast_wpseo_focuskw = focusKeyword;
    }

    const tryUpdate = async (
      label: string,
      pack: Record<string, unknown>,
    ) => {
      if (!Object.keys(pack).length) return;
      try {
        await http.post(`/posts/${postId}`, { meta: pack });
        this.logger.log(`SEO meta synced (${label}) for post ${postId}`);
      } catch (err) {
        const msg =
          err?.response?.data?.message || err?.message || 'unknown error';
        this.logger.warn(
          `SEO meta sync failed (${label}) for post ${postId}: ${msg}`,
        );
        warnings.push(`${label}: ${msg}`);
      }
    };

    await tryUpdate('rankmath', rankmath);
    await tryUpdate('yoast', yoast);

    if (warnings.length) {
      return (
        warnings.join(' | ') +
        ' — Install SheetPress SEO Bridge on WordPress, then Update on WordPress again.'
      );
    }

    return (
      'SEO sent via REST fallback (often ignored by Rank Math). ' +
      'Install SheetPress SEO Bridge plugin, then Update on WordPress again.'
    );
  }

  async checkSeoBridge(siteId: string, userId?: string) {
    const creds = await this.sitesService.getDecryptedCredentials(
      siteId,
      userId,
    );
    try {
      const res = await axios.get(
        `${creds.baseUrl}/wp-json/sheetpress/v1/ping`,
        {
          auth: { username: creds.username, password: creds.password },
          timeout: 15000,
          validateStatus: (s) => s < 500,
        },
      );
      if (res.status >= 200 && res.status < 300 && res.data?.ok) {
        return {
          data: {
            installed: true,
            ...res.data,
          },
        };
      }
      return {
        data: {
          installed: false,
          status: res.status,
          message:
            'SheetPress SEO Bridge not found. Upload sheetpress-seo-bridge.zip in WordPress → Plugins.',
        },
      };
    } catch (err) {
      return {
        data: {
          installed: false,
          message:
            err?.response?.status === 404
              ? 'SheetPress SEO Bridge plugin is not installed or not activated.'
              : err?.message || 'Could not reach SEO Bridge ping endpoint',
        },
      };
    }
  }

  async deletePost(siteId: string, postId: number, userId?: string) {
    const { http } = await this.client(siteId, userId);
    try {
      const res = await http.delete(`/posts/${postId}`, {
        params: { force: true },
      });
      return { data: { deleted: true, id: postId, raw: res.data } };
    } catch (err) {
      this.throwWpError('deletePost', err);
    }
  }

  async uploadImage(
    siteId: string,
    buffer: Buffer,
    filename: string,
    mimeType = 'image/jpeg',
    userId?: string,
  ) {
    const { http } = await this.client(siteId, userId);
    const safeName = this.ensureWpFilename(filename, mimeType);
    const form = new FormData();
    form.append('file', buffer, { filename: safeName, contentType: mimeType });
    try {
      const res = await http.post('/media', form, {
        headers: {
          ...form.getHeaders(),
          'Content-Disposition': `attachment; filename="${safeName}"`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      return {
        data: {
          id: res.data.id,
          source_url: res.data.source_url,
          link: res.data.link,
          raw: res.data,
        },
      };
    } catch (err) {
      this.throwWpError('uploadImage', err);
    }
  }

  private ensureWpFilename(filename: string, mimeType: string) {
    const base = (filename || 'image').replace(/[^\w.\-]+/g, '_') || 'image';
    if (/\.(jpe?g|png|gif|webp)$/i.test(base)) return base;
    const mime = (mimeType || '').toLowerCase();
    if (mime.includes('png')) return `${base}.png`;
    if (mime.includes('webp')) return `${base}.webp`;
    if (mime.includes('gif')) return `${base}.gif`;
    return `${base}.jpg`;
  }

  async fetchCategories(siteId: string, userId?: string) {
    const { http } = await this.client(siteId, userId);
    try {
      const res = await http.get('/categories', {
        params: { per_page: 100 },
      });
      return { data: res.data };
    } catch (err) {
      this.throwWpError('fetchCategories', err);
    }
  }

  async createCategory(
    siteId: string,
    dto: CreateTaxonomyDto,
    userId?: string,
  ) {
    const { http } = await this.client(siteId, userId);
    try {
      const res = await http.post('/categories', dto);
      return { data: res.data };
    } catch (err) {
      this.throwWpError('createCategory', err);
    }
  }

  async fetchTags(siteId: string, userId?: string) {
    const { http } = await this.client(siteId, userId);
    try {
      const res = await http.get('/tags', { params: { per_page: 100 } });
      return { data: res.data };
    } catch (err) {
      this.throwWpError('fetchTags', err);
    }
  }

  async createTag(siteId: string, dto: CreateTaxonomyDto, userId?: string) {
    const { http } = await this.client(siteId, userId);
    try {
      const res = await http.post('/tags', dto);
      return { data: res.data };
    } catch (err) {
      this.throwWpError('createTag', err);
    }
  }

  async fetchAuthors(siteId: string, userId?: string) {
    const { http } = await this.client(siteId, userId);
    try {
      const res = await http.get('/users', { params: { per_page: 100 } });
      return { data: res.data };
    } catch (err) {
      this.throwWpError('fetchAuthors', err);
    }
  }

  async checkPostStatus(siteId: string, postId: number, userId?: string) {
    const { http } = await this.client(siteId, userId);
    try {
      const res = await http.get(`/posts/${postId}`);
      return {
        data: {
          id: res.data.id,
          status: res.data.status,
          link: res.data.link,
          modified: res.data.modified,
        },
      };
    } catch (err) {
      this.throwWpError('checkPostStatus', err);
    }
  }

  async getPublishedUrl(siteId: string, postId: number, userId?: string) {
    const result = await this.checkPostStatus(siteId, postId, userId);
    return { data: { url: result!.data.link, status: result!.data.status } };
  }

  private throwWpError(op: string, err: any): never {
    const msg =
      err?.response?.data?.message ||
      err?.message ||
      'WordPress API request failed';
    this.logger.error(`${op} failed: ${msg}`);
    throw new BadRequestException(`WordPress ${op} failed: ${msg}`);
  }
}
