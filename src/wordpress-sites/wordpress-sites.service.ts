import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';
import { SitePlatform, SiteStatus } from '../common/enums';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

const SHOPIFY_API_VERSION = '2024-10';

@Injectable()
export class WordPressSitesService {
  private readonly logger = new Logger(WordPressSitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async create(userId: string, dto: CreateSiteDto) {
    const platform =
      dto.platform === 'SHOPIFY' ? SitePlatform.SHOPIFY : SitePlatform.WORDPRESS;

    if (platform === SitePlatform.SHOPIFY) {
      return this.createShopify(userId, dto);
    }
    return this.createWordPress(userId, dto);
  }

  private async createWordPress(userId: string, dto: CreateSiteDto) {
    if (!dto.url || !dto.username || !dto.applicationPassword) {
      throw new BadRequestException(
        'WordPress requires url, username, and applicationPassword',
      );
    }
    const encryptedPassword = this.encryption.encrypt(dto.applicationPassword);
    const site = await this.prisma.wordPressSite.create({
      data: {
        userId,
        name: dto.name,
        platform: SitePlatform.WORDPRESS,
        url: this.normalizeUrl(dto.url),
        username: dto.username,
        encryptedPassword,
        status: SiteStatus.DISCONNECTED,
        publishedCount: 0,
      },
    });

    try {
      const info = await this.testWordPressInternal(site);
      const updated = await this.prisma.wordPressSite.update({
        where: { id: site.id },
        data: {
          status: SiteStatus.CONNECTED,
          lastConnectedAt: new Date(),
          wpInfo: info,
        },
      });
      await this.auditConnect(userId, site.id, site.name, site.url, true);
      return { data: this.sanitize(updated), connected: true };
    } catch (err) {
      this.logger.warn(`WP site created but connection failed: ${err.message}`);
      await this.auditConnect(
        userId,
        site.id,
        site.name,
        site.url,
        false,
        err.message,
      );
      return {
        data: this.sanitize(site),
        warning: err.message as string,
        connected: false,
      };
    }
  }

  private async createShopify(userId: string, dto: CreateSiteDto) {
    if (!dto.storeDomain || !dto.accessToken) {
      throw new BadRequestException(
        'Shopify requires storeDomain and accessToken',
      );
    }
    const storeDomain = this.normalizeStoreDomain(dto.storeDomain);
    const encryptedAccessToken = this.encryption.encrypt(dto.accessToken.trim());
    const url = `https://${storeDomain}`;

    const site = await this.prisma.wordPressSite.create({
      data: {
        userId,
        name: dto.name,
        platform: SitePlatform.SHOPIFY,
        url,
        storeDomain,
        encryptedAccessToken,
        blogId: dto.blogId?.trim() || null,
        username: '',
        encryptedPassword: '',
        status: SiteStatus.DISCONNECTED,
        publishedCount: 0,
      },
    });

    try {
      const info = await this.testShopifyInternal({
        storeDomain,
        encryptedAccessToken,
        blogId: site.blogId,
      });
      const blogId = site.blogId || info.defaultBlogId || null;
      const updated = await this.prisma.wordPressSite.update({
        where: { id: site.id },
        data: {
          status: SiteStatus.CONNECTED,
          lastConnectedAt: new Date(),
          shopInfo: info,
          blogId,
        },
      });
      await this.auditConnect(userId, site.id, site.name, url, true);
      return {
        data: this.sanitize(updated),
        connected: true,
        blogs: info.blogs,
      };
    } catch (err) {
      this.logger.warn(
        `Shopify site created but connection failed: ${err.message}`,
      );
      await this.auditConnect(
        userId,
        site.id,
        site.name,
        url,
        false,
        err.message,
      );
      return {
        data: this.sanitize(site),
        warning: err.message as string,
        connected: false,
      };
    }
  }

  async findAll(userId: string) {
    const sites = await this.prisma.wordPressSite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return { data: sites.map((s) => this.sanitize(s)) };
  }

  async findOne(userId: string, id: string) {
    const site = await this.getOwnedSite(userId, id);
    return { data: this.sanitize(site) };
  }

  async update(userId: string, id: string, dto: UpdateSiteDto) {
    const existing = await this.getOwnedSite(userId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;

    if (existing.platform === SitePlatform.SHOPIFY) {
      if (dto.storeDomain !== undefined) {
        const storeDomain = this.normalizeStoreDomain(dto.storeDomain);
        data.storeDomain = storeDomain;
        data.url = `https://${storeDomain}`;
      }
      if (dto.accessToken !== undefined) {
        data.encryptedAccessToken = this.encryption.encrypt(
          dto.accessToken.trim(),
        );
        data.status = SiteStatus.NEEDS_RECONNECT;
      }
      if (dto.blogId !== undefined) data.blogId = dto.blogId;
    } else {
      if (dto.url !== undefined) data.url = this.normalizeUrl(dto.url);
      if (dto.username !== undefined) data.username = dto.username;
      if (dto.applicationPassword !== undefined) {
        data.encryptedPassword = this.encryption.encrypt(
          dto.applicationPassword,
        );
        data.status = SiteStatus.NEEDS_RECONNECT;
      }
    }

    const site = await this.prisma.wordPressSite.update({
      where: { id },
      data,
    });
    return { data: this.sanitize(site) };
  }

  async remove(userId: string, id: string) {
    await this.getOwnedSite(userId, id);
    await this.prisma.wordPressSite.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  async testConnection(userId: string, id: string) {
    const site = await this.getOwnedSite(userId, id);
    try {
      if (site.platform === SitePlatform.SHOPIFY) {
        const info = await this.testShopifyInternal({
          storeDomain: site.storeDomain || this.normalizeStoreDomain(site.url),
          encryptedAccessToken: site.encryptedAccessToken || '',
          blogId: site.blogId,
        });
        const blogId = site.blogId || info.defaultBlogId || null;
        const updated = await this.prisma.wordPressSite.update({
          where: { id },
          data: {
            status: SiteStatus.CONNECTED,
            lastConnectedAt: new Date(),
            shopInfo: info,
            blogId,
          },
        });
        return {
          data: {
            connected: true,
            site: this.sanitize(updated),
            info,
            blogs: info.blogs,
          },
        };
      }

      const info = await this.testWordPressInternal(site);
      const updated = await this.prisma.wordPressSite.update({
        where: { id },
        data: {
          status: SiteStatus.CONNECTED,
          lastConnectedAt: new Date(),
          wpInfo: info,
        },
      });
      return { data: { connected: true, site: this.sanitize(updated), info } };
    } catch (err) {
      await this.prisma.wordPressSite.update({
        where: { id },
        data: { status: SiteStatus.NEEDS_RECONNECT },
      });
      throw new BadRequestException(
        `${site.platform === SitePlatform.SHOPIFY ? 'Shopify' : 'WordPress'} connection failed: ${err.message}`,
      );
    }
  }

  async fetchWpInfo(userId: string, id: string) {
    return this.testConnection(userId, id);
  }

  async getDecryptedCredentials(siteId: string, userId?: string) {
    const site = await this.prisma.wordPressSite.findUnique({
      where: { id: siteId },
    });
    if (!site) throw new NotFoundException('Site not found');
    if (userId && site.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    if (site.platform === SitePlatform.SHOPIFY) {
      throw new BadRequestException(
        'This site is Shopify — use getShopifyCredentials',
      );
    }
    return {
      site,
      username: site.username,
      password: this.encryption.decrypt(site.encryptedPassword),
      baseUrl: this.normalizeUrl(site.url),
    };
  }

  async getShopifyCredentials(siteId: string, userId?: string) {
    const site = await this.prisma.wordPressSite.findUnique({
      where: { id: siteId },
    });
    if (!site) throw new NotFoundException('Site not found');
    if (userId && site.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    if (site.platform !== SitePlatform.SHOPIFY) {
      throw new BadRequestException('This site is not a Shopify connection');
    }
    if (!site.encryptedAccessToken) {
      throw new BadRequestException('Shopify access token missing');
    }
    const storeDomain =
      site.storeDomain || this.normalizeStoreDomain(site.url);
    return {
      site,
      storeDomain,
      accessToken: this.encryption.decrypt(site.encryptedAccessToken),
      blogId: site.blogId,
    };
  }

  private async testWordPressInternal(site: {
    url: string;
    username: string;
    encryptedPassword: string;
  }) {
    const password = this.encryption.decrypt(site.encryptedPassword);
    const base = this.normalizeUrl(site.url);
    const res = await axios.get(`${base}/wp-json/wp/v2/users/me`, {
      auth: { username: site.username, password },
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Invalid credentials. Username must be your WordPress login username (e.g. Admin)—NOT the Application Password name. Password must be a newly generated Application Password (Users → Profile → Application Passwords), not your normal login password.',
      );
    }
    if (res.status >= 400) {
      throw new Error(`WordPress returned status ${res.status}`);
    }
    return {
      id: res.data?.id,
      name: res.data?.name,
      slug: res.data?.slug,
      capabilities: res.data?.capabilities,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async testShopifyInternal(site: {
    storeDomain: string;
    encryptedAccessToken: string;
    blogId?: string | null;
  }) {
    if (!site.encryptedAccessToken) {
      throw new Error('Missing Shopify Admin API access token');
    }
    const token = this.encryption.decrypt(site.encryptedAccessToken);
    const domain = this.normalizeStoreDomain(site.storeDomain);
    const headers = {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    };
    const base = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;

    const shopRes = await axios.get(`${base}/shop.json`, {
      headers,
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });
    if (shopRes.status === 401 || shopRes.status === 403) {
      throw new Error(
        'Invalid Shopify token. Create a custom app → Admin API access token with read_content, write_content (and read_products if needed).',
      );
    }
    if (shopRes.status >= 400) {
      throw new Error(`Shopify returned status ${shopRes.status}`);
    }

    const blogsRes = await axios.get(`${base}/blogs.json`, {
      headers,
      timeout: 15000,
      validateStatus: (s) => s < 500,
    });
    if (blogsRes.status >= 400) {
      throw new Error(
        `Could not list blogs (status ${blogsRes.status}). Ensure the app has read_content / write_content scopes.`,
      );
    }

    const blogs = (blogsRes.data?.blogs || []).map(
      (b: { id: number; title: string; handle: string }) => ({
        id: String(b.id),
        title: b.title,
        handle: b.handle,
      }),
    );

    if (!blogs.length) {
      throw new Error(
        'No blogs found on this Shopify store. Create a blog in Shopify Admin → Online Store → Blog posts.',
      );
    }

    let defaultBlogId = site.blogId || null;
    if (defaultBlogId && !blogs.some((b) => b.id === defaultBlogId)) {
      throw new Error(
        `Blog ID ${defaultBlogId} not found on this shop. Available: ${blogs.map((b) => `${b.title} (${b.id})`).join(', ')}`,
      );
    }
    if (!defaultBlogId) defaultBlogId = blogs[0].id;

    return {
      shopName: shopRes.data?.shop?.name,
      shopDomain: shopRes.data?.shop?.myshopify_domain || domain,
      blogs,
      defaultBlogId,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async auditConnect(
    userId: string,
    entityId: string,
    name: string,
    url: string,
    connected: boolean,
    error?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'CONNECT',
        entity: 'WordPressSite',
        entityId,
        metadata: { name, url, connected, ...(error ? { error } : {}) },
      },
    });
  }

  private async getOwnedSite(userId: string, id: string) {
    const site = await this.prisma.wordPressSite.findUnique({ where: { id } });
    if (!site) throw new NotFoundException('Site not found');
    if (site.userId !== userId) throw new ForbiddenException('Access denied');
    return site;
  }

  private normalizeUrl(url: string) {
    return url.replace(/\/+$/, '');
  }

  /** Accepts my-store.myshopify.com or full https URL */
  normalizeStoreDomain(input: string) {
    let v = input.trim().toLowerCase();
    v = v.replace(/^https?:\/\//, '');
    v = v.split('/')[0];
    v = v.replace(/\/+$/, '');
    if (!v.includes('.')) {
      v = `${v}.myshopify.com`;
    }
    return v;
  }

  private sanitize(site: Record<string, any>) {
    const {
      encryptedPassword: _p,
      encryptedAccessToken: _t,
      ...rest
    } = site;
    return rest;
  }
}
