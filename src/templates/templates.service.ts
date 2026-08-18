import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

const SEO_STRUCTURE_PRESET = {
  name: 'SEO Structured Post',
  category: 'SEO',
  tags: ['seo', 'ranking'],
  contentBefore: `<!-- SheetPress template: intro -->
<div class="sp-intro" style="margin:0 0 1.5rem;padding:1rem 1.25rem;border-left:4px solid #2563eb;background:#f8fafc;">
<p style="margin:0;"><strong>Quick summary:</strong> Use this section for a short intro that includes your focus keyword early.</p>
</div>
`,
  contentAfter: `<!-- SheetPress template: cta + bio -->
<hr style="margin:2rem 0;" />
<div class="sp-cta" style="margin:1.5rem 0;padding:1.25rem;border:1px solid #e2e8f0;border-radius:8px;background:#fff;">
<p style="margin:0 0 0.5rem;"><strong>Need help implementing this?</strong></p>
<p style="margin:0;">Contact our team for a free consultation and a custom growth plan.</p>
</div>
<div class="sp-author" style="margin-top:1.5rem;font-size:0.95em;color:#475569;">
<p style="margin:0;"><em>Written by the Social Velocityy content team. Updated for 2026.</em></p>
</div>
`,
};

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: string, siteId?: string) {
    const templates = await this.prisma.contentTemplate.findMany({
      where: {
        userId,
        ...(siteId
          ? { OR: [{ siteId }, { siteId: null }] }
          : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      include: { site: { select: { id: true, name: true } } },
    });
    return { data: templates };
  }

  async findOne(userId: string, id: string) {
    const template = await this.getOwned(userId, id);
    return { data: template };
  }

  async create(userId: string, dto: CreateTemplateDto) {
    if (dto.siteId) {
      await this.assertSite(userId, dto.siteId);
    }
    if (dto.isDefault) {
      await this.clearDefault(userId, dto.siteId || null);
    }
    const template = await this.prisma.contentTemplate.create({
      data: {
        userId,
        siteId: dto.siteId || null,
        name: dto.name,
        category: dto.category || null,
        tags: dto.tags || [],
        contentBefore: dto.contentBefore || null,
        contentAfter: dto.contentAfter || null,
        isDefault: !!dto.isDefault,
      },
      include: { site: { select: { id: true, name: true } } },
    });
    return { data: template };
  }

  async createSeoPreset(userId: string, siteId?: string) {
    return this.create(userId, {
      ...SEO_STRUCTURE_PRESET,
      siteId,
      isDefault: true,
    });
  }

  async update(userId: string, id: string, dto: UpdateTemplateDto) {
    await this.getOwned(userId, id);
    if (dto.siteId) {
      await this.assertSite(userId, dto.siteId);
    }
    if (dto.isDefault) {
      const current = await this.prisma.contentTemplate.findUnique({
        where: { id },
      });
      await this.clearDefault(
        userId,
        dto.siteId !== undefined ? dto.siteId : current?.siteId || null,
        id,
      );
    }
    const template = await this.prisma.contentTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.siteId !== undefined && { siteId: dto.siteId }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.contentBefore !== undefined && {
          contentBefore: dto.contentBefore,
        }),
        ...(dto.contentAfter !== undefined && {
          contentAfter: dto.contentAfter,
        }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      },
      include: { site: { select: { id: true, name: true } } },
    });
    return { data: template };
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    await this.prisma.contentTemplate.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  /** Resolve template for an article (explicit → site default → user default). */
  async resolveForArticle(
    userId: string,
    siteId: string,
    templateId?: string | null,
  ) {
    if (templateId) {
      const t = await this.prisma.contentTemplate.findFirst({
        where: { id: templateId, userId },
      });
      if (t) return t;
    }
    const siteDefault = await this.prisma.contentTemplate.findFirst({
      where: { userId, siteId, isDefault: true },
    });
    if (siteDefault) return siteDefault;
    return this.prisma.contentTemplate.findFirst({
      where: { userId, siteId: null, isDefault: true },
    });
  }

  applyToContent(
    content: string,
    template: {
      contentBefore?: string | null;
      contentAfter?: string | null;
    } | null,
  ) {
    if (!template) return content;
    const before = template.contentBefore?.trim() || '';
    const after = template.contentAfter?.trim() || '';
    if (!before && !after) return content;
    // Avoid double-wrapping if already applied
    if (
      (before && content.includes(before.slice(0, 40))) ||
      content.includes('<!-- SheetPress template:')
    ) {
      return content;
    }
    return `${before}${content}${after}`;
  }

  private async clearDefault(
    userId: string,
    siteId: string | null,
    exceptId?: string,
  ) {
    await this.prisma.contentTemplate.updateMany({
      where: {
        userId,
        siteId,
        isDefault: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefault: false },
    });
  }

  private async assertSite(userId: string, siteId: string) {
    const site = await this.prisma.wordPressSite.findFirst({
      where: { id: siteId, userId },
    });
    if (!site) throw new BadRequestException('Site not found');
  }

  private async getOwned(userId: string, id: string) {
    const template = await this.prisma.contentTemplate.findUnique({
      where: { id },
      include: { site: { select: { id: true, name: true } } },
    });
    if (!template) throw new NotFoundException('Template not found');
    if (template.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return template;
  }
}
