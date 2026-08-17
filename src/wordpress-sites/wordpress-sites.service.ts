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
import { SiteStatus } from '../common/enums';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';

@Injectable()
export class WordPressSitesService {
  private readonly logger = new Logger(WordPressSitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async create(userId: string, dto: CreateSiteDto) {
    const encryptedPassword = this.encryption.encrypt(dto.applicationPassword);
    const site = await this.prisma.wordPressSite.create({
      data: {
        userId,
        name: dto.name,
        url: this.normalizeUrl(dto.url),
        username: dto.username,
        encryptedPassword,
        status: SiteStatus.DISCONNECTED,
        publishedCount: 0,
      },
    });

    try {
      const info = await this.testConnectionInternal(site);
      const updated = await this.prisma.wordPressSite.update({
        where: { id: site.id },
        data: {
          status: SiteStatus.CONNECTED,
          lastConnectedAt: new Date(),
          wpInfo: info,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'CONNECT',
          entity: 'WordPressSite',
          entityId: site.id,
          metadata: { name: site.name, url: site.url, connected: true },
        },
      });
      return {
        data: this.sanitize(updated),
        connected: true,
      };
    } catch (err) {
      this.logger.warn(`Site created but connection failed: ${err.message}`);
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'CONNECT',
          entity: 'WordPressSite',
          entityId: site.id,
          metadata: {
            name: site.name,
            url: site.url,
            connected: false,
            error: err.message,
          },
        },
      });
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
    await this.getOwnedSite(userId, id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.url !== undefined) data.url = this.normalizeUrl(dto.url);
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.applicationPassword !== undefined) {
      data.encryptedPassword = this.encryption.encrypt(dto.applicationPassword);
      data.status = SiteStatus.NEEDS_RECONNECT;
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
      const info = await this.testConnectionInternal(site);
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
        `WordPress connection failed: ${err.message}`,
      );
    }
  }

  async fetchWpInfo(userId: string, id: string) {
    const site = await this.getOwnedSite(userId, id);
    const info = await this.testConnectionInternal(site);
    const updated = await this.prisma.wordPressSite.update({
      where: { id },
      data: { wpInfo: info, lastConnectedAt: new Date() },
    });
    return { data: { info, site: this.sanitize(updated) } };
  }

  async getDecryptedCredentials(siteId: string, userId?: string) {
    const site = await this.prisma.wordPressSite.findUnique({
      where: { id: siteId },
    });
    if (!site) throw new NotFoundException('Site not found');
    if (userId && site.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return {
      site,
      username: site.username,
      password: this.encryption.decrypt(site.encryptedPassword),
      baseUrl: this.normalizeUrl(site.url),
    };
  }

  private async testConnectionInternal(site: {
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

  private async getOwnedSite(userId: string, id: string) {
    const site = await this.prisma.wordPressSite.findUnique({ where: { id } });
    if (!site) throw new NotFoundException('Site not found');
    if (site.userId !== userId) throw new ForbiddenException('Access denied');
    return site;
  }

  private normalizeUrl(url: string) {
    return url.replace(/\/+$/, '');
  }

  private sanitize(site: Record<string, any>) {
    const { encryptedPassword: _, ...rest } = site;
    return rest;
  }
}
