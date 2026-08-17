import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSeoDto } from './dto/update-seo.dto';

export type SeoPlugin = 'yoast' | 'rankmath' | 'both';

/** Rank Math stores primary + secondary (LSI) keywords as comma-separated. */
export function combineFocusAndLsi(
  focusKeyword?: string | null,
  lsiKeywords?: string | null,
): string {
  const parts = [
    ...(focusKeyword || '').split(/[,|;]/),
    ...(lsiKeywords || '').split(/[,|;]/),
  ]
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join(', ');
}

@Injectable()
export class SeoService {
  private readonly logger = new Logger(SeoService.name);

  constructor(private readonly prisma: PrismaService) {}

  buildWpMeta(input: {
    seoTitle?: string | null;
    seoDescription?: string | null;
    focusKeyword?: string | null;
    lsiKeywords?: string | null;
    plugin?: SeoPlugin;
  }): Record<string, string> {
    const plugin = input.plugin || 'rankmath';
    const meta: Record<string, string> = {};
    const combined = combineFocusAndLsi(
      input.focusKeyword,
      input.lsiKeywords,
    );
    const primary = (input.focusKeyword || '').split(/[,|;]/)[0]?.trim() || '';

    if (input.seoTitle) {
      if (plugin === 'yoast' || plugin === 'both') {
        meta._yoast_wpseo_title = input.seoTitle;
      }
      if (plugin === 'rankmath' || plugin === 'both') {
        meta.rank_math_title = input.seoTitle;
      }
    }

    if (input.seoDescription) {
      if (plugin === 'yoast' || plugin === 'both') {
        meta._yoast_wpseo_metadesc = input.seoDescription;
      }
      if (plugin === 'rankmath' || plugin === 'both') {
        meta.rank_math_description = input.seoDescription;
      }
    }

    if (combined) {
      // Rank Math: primary + LSI as comma-separated list
      if (plugin === 'rankmath' || plugin === 'both') {
        meta.rank_math_focus_keyword = combined;
      }
      // Yoast: primary focus keyword only
      if ((plugin === 'yoast' || plugin === 'both') && primary) {
        meta._yoast_wpseo_focuskw = primary;
      }
    }

    return meta;
  }

  /** Separate packs so one plugin's protected keys don't block the other. */
  buildMetaPacks(input: {
    seoTitle?: string | null;
    seoDescription?: string | null;
    focusKeyword?: string | null;
    lsiKeywords?: string | null;
  }) {
    return {
      rankmath: this.buildWpMeta({ ...input, plugin: 'rankmath' }),
      yoast: this.buildWpMeta({ ...input, plugin: 'yoast' }),
    };
  }

  mapFromYoast(meta: Record<string, unknown>) {
    return {
      seoTitle: (meta._yoast_wpseo_title as string) || null,
      seoDescription: (meta._yoast_wpseo_metadesc as string) || null,
      focusKeyword: (meta._yoast_wpseo_focuskw as string) || null,
    };
  }

  mapFromRankMath(meta: Record<string, unknown>) {
    const raw = String(meta.rank_math_focus_keyword || '');
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      seoTitle: (meta.rank_math_title as string) || null,
      seoDescription: (meta.rank_math_description as string) || null,
      focusKeyword: parts[0] || null,
      lsiKeywords: parts.slice(1).join(', ') || null,
    };
  }

  async updateArticleSeo(userId: string, dto: UpdateSeoDto) {
    const article = await this.prisma.article.findUnique({
      where: { id: dto.articleId },
    });
    if (!article) throw new NotFoundException('Article not found');
    if (article.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    const updated = await this.prisma.article.update({
      where: { id: dto.articleId },
      data: {
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
      },
    });

    return {
      data: {
        article: updated,
        wpMeta: this.buildWpMeta({
          seoTitle: updated.seoTitle,
          seoDescription: updated.seoDescription,
          focusKeyword: updated.focusKeyword,
          lsiKeywords: updated.lsiKeywords,
          plugin: dto.plugin || 'rankmath',
        }),
        packs: this.buildMetaPacks({
          seoTitle: updated.seoTitle,
          seoDescription: updated.seoDescription,
          focusKeyword: updated.focusKeyword,
          lsiKeywords: updated.lsiKeywords,
        }),
      },
    };
  }

  async previewMeta(userId: string, articleId: string) {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });
    if (!article) throw new NotFoundException('Article not found');
    if (article.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return {
      data: {
        seoTitle: article.seoTitle || article.title,
        seoDescription:
          article.seoDescription ||
          article.excerpt ||
          article.content.replace(/<[^>]+>/g, '').slice(0, 160),
        focusKeyword: article.focusKeyword,
        lsiKeywords: article.lsiKeywords,
        yoast: this.buildWpMeta({
          seoTitle: article.seoTitle,
          seoDescription: article.seoDescription,
          focusKeyword: article.focusKeyword,
          lsiKeywords: article.lsiKeywords,
          plugin: 'yoast',
        }),
        rankmath: this.buildWpMeta({
          seoTitle: article.seoTitle,
          seoDescription: article.seoDescription,
          focusKeyword: article.focusKeyword,
          lsiKeywords: article.lsiKeywords,
          plugin: 'rankmath',
        }),
      },
    };
  }
}
