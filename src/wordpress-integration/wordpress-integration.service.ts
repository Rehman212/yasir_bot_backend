import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { WordPressSitesService } from '../wordpress-sites/wordpress-sites.service';
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
        meta: dto.meta,
      });
      return {
        data: {
          id: res.data.id,
          link: res.data.link,
          status: res.data.status,
          slug: res.data.slug,
          raw: res.data,
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
      const res = await http.post(`/posts/${postId}`, dto);
      return {
        data: {
          id: res.data.id,
          link: res.data.link,
          status: res.data.status,
          raw: res.data,
        },
      };
    } catch (err) {
      this.throwWpError('updatePost', err);
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
    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimeType });
    try {
      const res = await http.post('/media', form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
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
