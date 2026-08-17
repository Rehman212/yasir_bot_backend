import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSeoDto } from './dto/update-seo.dto';

@Injectable()
export class SeoService {
  constructor(private readonly prisma: PrismaService) {}

  buildWpMeta(input: {
    seoTitle?: string | null;
    seoDescription?: string | null;
    focusKeyword?: string | null;
    plugin?: 'yoast' | 'rankmath' | 'both';
  }): Record<string, string> {
    const plugin = input.plugin || 'both';
    const meta: Record<string, string> = {};

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

    if (input.focusKeyword) {
      if (plugin === 'yoast' || plugin === 'both') {
        meta._yoast_wpseo_focuskw = input.focusKeyword;
      }
      if (plugin === 'rankmath' || plugin === 'both') {
        meta.rank_math_focus_keyword = input.focusKeyword;
      }
    }

    return meta;
  }

  mapFromYoast(meta: Record<string, unknown>) {
    return {
      seoTitle: (meta._yoast_wpseo_title as string) || null,
      seoDescription: (meta._yoast_wpseo_metadesc as string) || null,
      focusKeyword: (meta._yoast_wpseo_focuskw as string) || null,
    };
  }

  mapFromRankMath(meta: Record<string, unknown>) {
    return {
      seoTitle: (meta.rank_math_title as string) || null,
      seoDescription: (meta.rank_math_description as string) || null,
      focusKeyword: (meta.rank_math_focus_keyword as string) || null,
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
      },
    });

    return {
      data: {
        article: updated,
        wpMeta: this.buildWpMeta({
          seoTitle: updated.seoTitle,
          seoDescription: updated.seoDescription,
          focusKeyword: updated.focusKeyword,
          plugin: dto.plugin,
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
        yoast: this.buildWpMeta({
          seoTitle: article.seoTitle,
          seoDescription: article.seoDescription,
          focusKeyword: article.focusKeyword,
          plugin: 'yoast',
        }),
        rankmath: this.buildWpMeta({
          seoTitle: article.seoTitle,
          seoDescription: article.seoDescription,
          focusKeyword: article.focusKeyword,
          plugin: 'rankmath',
        }),
      },
    };
  }
}
