import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(userId: string) {
    const [
      connectedWebsites,
      importedArticles,
      published,
      scheduled,
      failed,
      subscription,
      recentImports,
      upcoming,
      recentActivity,
    ] = await Promise.all([
      this.prisma.wordPressSite.count({
        where: { userId, status: 'CONNECTED' },
      }),
      this.prisma.article.count({ where: { userId } }),
      this.prisma.article.count({ where: { userId, status: 'PUBLISHED' } }),
      this.prisma.article.count({
        where: { userId, status: { in: ['SCHEDULED', 'QUEUED'] } },
      }),
      this.prisma.article.count({ where: { userId, status: 'FAILED' } }),
      this.prisma.subscription.findUnique({ where: { userId } }),
      this.prisma.importBatch.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { site: { select: { name: true } } },
      }),
      this.prisma.article.findMany({
        where: { userId, status: { in: ['SCHEDULED', 'QUEUED'] } },
        orderBy: { publishAt: 'asc' },
        take: 5,
        include: { site: { select: { name: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    const monthlyUsage = subscription
      ? `${subscription.articlesUsed} / ${subscription.articleLimit}`
      : '0 / 10';

    return {
      data: {
        stats: [
          { label: 'Connected websites', value: String(connectedWebsites) },
          { label: 'Imported articles', value: String(importedArticles) },
          { label: 'Published', value: String(published) },
          { label: 'Scheduled', value: String(scheduled) },
          { label: 'Failed', value: String(failed) },
          { label: 'Monthly usage', value: monthlyUsage },
        ],
        recentImports: recentImports.map((b) => ({
          id: b.id,
          label: `${b.filename || b.source} · ${b.rowCount} articles`,
          status: b.status,
          site: b.site.name,
        })),
        upcoming: upcoming.map((a) => ({
          id: a.id,
          title: a.title,
          publishDate: a.publishAt,
          website: a.site.name,
          status: a.status,
        })),
        recentActivity: recentActivity.map((l) => ({
          id: l.id,
          event: l.action,
          detail: `${l.entity}${l.entityId ? ` · ${l.entityId}` : ''}`,
          time: l.createdAt,
        })),
        failedCount: failed,
      },
    };
  }
}
