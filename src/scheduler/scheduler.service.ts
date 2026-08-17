import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { ArticleStatus, JobStatus } from '../common/enums';
import { ScheduleBatchDto } from './dto/schedule.dto';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async scheduleBatch(userId: string, dto: ScheduleBatchDto) {
    const timezone = dto.timezone || 'UTC';
    const intervalMs = (dto.intervalMinutes ?? 5) * 60 * 1000;
    let cursor = new Date(dto.startAt);

    if (isNaN(cursor.getTime())) {
      throw new NotFoundException('Invalid startAt date');
    }

    const results: Array<Record<string, unknown>> = [];
    for (const articleId of dto.articleIds) {
      const article = await this.prisma.article.findUnique({
        where: { id: articleId },
      });
      if (!article || article.userId !== userId) {
        results.push({ articleId, error: 'Not found or access denied' });
        continue;
      }

      await this.prisma.article.update({
        where: { id: articleId },
        data: {
          status: ArticleStatus.SCHEDULED,
          publishAt: cursor,
        },
      });

      const enqueued = await this.queue.enqueue(userId, {
        articleIds: [articleId],
        scheduledAt: cursor.toISOString(),
        timezone,
      });

      results.push({
        articleId,
        publishAt: cursor.toISOString(),
        timezone,
        jobs: enqueued.data.jobs,
      });

      cursor = new Date(cursor.getTime() + intervalMs);
    }

    return { data: { scheduled: results, timezone, intervalMinutes: dto.intervalMinutes ?? 5 } };
  }

  async listScheduled(userId: string) {
    const articles = await this.prisma.article.findMany({
      where: {
        userId,
        status: ArticleStatus.SCHEDULED,
      },
      orderBy: { publishAt: 'asc' },
    });
    return { data: articles };
  }

  async cancelSchedule(userId: string, articleId: string) {
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });
    if (!article) throw new NotFoundException('Article not found');
    if (article.userId !== userId) throw new ForbiddenException('Access denied');

    const jobs = await this.prisma.publishJob.findMany({
      where: {
        articleId,
        status: { in: [JobStatus.WAITING, JobStatus.DELAYED, JobStatus.PAUSED] },
      },
    });

    for (const job of jobs) {
      await this.queue.cancel(userId, job.id);
    }

    const updated = await this.prisma.article.update({
      where: { id: articleId },
      data: {
        status: ArticleStatus.DRAFT,
        publishAt: null,
      },
    });

    return { data: updated };
  }

  async recoverMissed(userId: string, siteId?: string) {
    const now = new Date();
    const missed = await this.prisma.article.findMany({
      where: {
        userId,
        ...(siteId && { siteId }),
        status: ArticleStatus.SCHEDULED,
        publishAt: { lte: now },
      },
    });

    this.logger.log(`Recovering ${missed.length} missed/delayed articles`);

    if (missed.length === 0) {
      return { data: { recovered: 0, jobs: [] } };
    }

    const result = await this.queue.enqueue(userId, {
      articleIds: missed.map((a) => a.id),
      delayMs: 3000,
    });

    return {
      data: {
        recovered: missed.length,
        jobs: result.data.jobs,
      },
    };
  }

  toTimezoneDate(date: Date, timezone: string): string {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(date);
    } catch {
      return date.toISOString();
    }
  }
}
