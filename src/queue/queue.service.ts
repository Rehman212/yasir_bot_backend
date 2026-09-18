import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PublishingService } from '../publishing/publishing.service';
import { ArticleStatus, JobStatus } from '../common/enums';
import { EnqueueArticlesDto, EnqueueByTitlesDto } from './dto/queue.dto';

export const PUBLISH_QUEUE = 'publish';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private redisAvailable = true;
  private defaultDelayMs = 2000;
  private duePoller: ReturnType<typeof setInterval> | null = null;
  private processingDue = false;

  constructor(
    @InjectQueue(PUBLISH_QUEUE) private readonly publishQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => PublishingService))
    private readonly publishing: PublishingService,
  ) {}

  async onModuleInit() {
    const redisEnabled =
      process.env.REDIS_ENABLED === 'true' && !process.env.VERCEL;

    if (!redisEnabled) {
      this.redisAvailable = false;
      this.logger.warn(
        'REDIS_ENABLED=false — using DB poller for scheduled jobs',
      );
    } else {
      try {
        const clientPromise = Promise.resolve(
          (this.publishQueue as any)?.client,
        );
        const client = await Promise.race([
          clientPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Redis client timeout')), 3000),
          ),
        ]);
        if (client && typeof (client as any).ping === 'function') {
          await Promise.race([
            (client as any).ping(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Redis ping timeout')), 3000),
            ),
          ]);
        }
        this.logger.log('BullMQ publish queue connected');
      } catch (err) {
        this.redisAvailable = false;
        this.logger.warn(
          `Redis unavailable — using DB poller for scheduled jobs: ${(err as Error).message}`,
        );
      }
    }

    // Always poll due jobs so schedules work without Redis / after restarts
    this.duePoller = setInterval(() => {
      void this.processDueJobs();
    }, 20_000);
  }

  onModuleDestroy() {
    if (this.duePoller) clearInterval(this.duePoller);
  }

  async enqueue(userId: string, dto: EnqueueArticlesDto) {
    const jobs: Array<Record<string, unknown>> = [];
    let delayOffset = 0;
    const perJobDelay = dto.delayMs ?? this.defaultDelayMs;
    const intervalMs = (dto.intervalMinutes ?? 0) * 60 * 1000;
    const baseScheduled = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    let scheduleCursor =
      baseScheduled && !isNaN(baseScheduled.getTime())
        ? new Date(baseScheduled)
        : null;

    for (const articleId of dto.articleIds) {
      const article = await this.prisma.article.findUnique({
        where: { id: articleId },
      });
      if (!article || article.userId !== userId) {
        jobs.push({ articleId, error: 'Not found or access denied' });
        continue;
      }

      const scheduledAt = scheduleCursor
        ? new Date(scheduleCursor)
        : dto.scheduledAt
          ? new Date(dto.scheduledAt)
          : null;
      const delay =
        scheduledAt && scheduledAt > new Date()
          ? scheduledAt.getTime() - Date.now()
          : delayOffset;

      const isScheduled = !!(scheduledAt && scheduledAt > new Date());

      const publishJob = await this.prisma.publishJob.create({
        data: {
          articleId,
          siteId: article.siteId,
          userId,
          status: isScheduled ? JobStatus.DELAYED : JobStatus.WAITING,
          scheduledAt: scheduledAt || new Date(Date.now() + delay),
          attempts: 0,
          maxAttempts: 3,
          progress: 0,
          timezone: dto.timezone || 'UTC',
        },
      });

      try {
        if (!this.redisAvailable) {
          this.logger.warn(
            `Redis down — job ${publishJob.id} stored in DB (poller will run it)`,
          );
        } else {
          const bullJob = await this.publishQueue.add(
            'publish-article',
            {
              publishJobId: publishJob.id,
              articleId,
              userId,
              siteId: article.siteId,
            },
            {
              delay,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: 100,
              removeOnFail: 200,
            },
          );

          await this.prisma.publishJob.update({
            where: { id: publishJob.id },
            data: { bullJobId: String(bullJob.id) },
          });
        }

        await this.prisma.article.update({
          where: { id: articleId },
          data: {
            status: isScheduled
              ? ArticleStatus.SCHEDULED
              : ArticleStatus.QUEUED,
            ...(scheduledAt ? { publishAt: scheduledAt } : {}),
          },
        });

        jobs.push({
          articleId,
          jobId: publishJob.id,
          delay,
          status: isScheduled ? 'SCHEDULED' : 'QUEUED',
          scheduledAt: publishJob.scheduledAt,
        });
      } catch (err) {
        this.redisAvailable = false;
        this.logger.warn(`Failed to enqueue bull job: ${err.message}`);

        await this.prisma.article.update({
          where: { id: articleId },
          data: {
            status: isScheduled
              ? ArticleStatus.SCHEDULED
              : ArticleStatus.QUEUED,
            ...(scheduledAt ? { publishAt: scheduledAt } : {}),
          },
        });

        jobs.push({
          articleId,
          jobId: publishJob.id,
          warning: err.message,
          status: isScheduled ? 'SCHEDULED' : 'QUEUED',
          scheduledAt: publishJob.scheduledAt,
        });
      }

      delayOffset += perJobDelay;
      if (scheduleCursor) {
        scheduleCursor = new Date(scheduleCursor.getTime() + intervalMs);
      }
    }

    return { data: { jobs, delayMs: perJobDelay } };
  }

  async enqueueByTitles(userId: string, dto: EnqueueByTitlesDto) {
    const site = await this.prisma.wordPressSite.findFirst({
      where: { id: dto.siteId, userId },
    });
    if (!site) throw new NotFoundException('Website not found');

    const startAt = new Date(dto.scheduledAt);
    if (isNaN(startAt.getTime())) {
      throw new BadRequestException('Invalid scheduledAt date');
    }

    const titles = [
      ...new Set(
        dto.titles
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
      ),
    ];
    if (titles.length === 0) {
      throw new BadRequestException('Paste at least one article title');
    }

    const createMissing = dto.createMissing !== false;
    const intervalMs = (dto.intervalMinutes ?? 0) * 60 * 1000;
    const timezone = dto.timezone || 'UTC';

    const resolved: Array<{
      title: string;
      articleId?: string;
      created?: boolean;
      error?: string;
    }> = [];
    const articleIds: string[] = [];
    const scheduleTimes: Date[] = [];
    let cursor = new Date(startAt);

    for (const title of titles) {
      let article = await this.prisma.article.findFirst({
        where: {
          userId,
          siteId: dto.siteId,
          title: { equals: title, mode: 'insensitive' },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (!article && createMissing) {
        article = await this.prisma.article.create({
          data: {
            userId,
            siteId: dto.siteId,
            title,
            content:
              '<p>Draft created from Publishing Queue — add content before it goes live.</p>',
            status: ArticleStatus.DRAFT,
          },
        });
        resolved.push({ title, articleId: article.id, created: true });
      } else if (!article) {
        resolved.push({ title, error: 'Article not found on this website' });
        continue;
      } else {
        resolved.push({ title, articleId: article.id, created: false });
      }

      articleIds.push(article.id);
      scheduleTimes.push(new Date(cursor));
      cursor = new Date(cursor.getTime() + intervalMs);
    }

    const jobs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < articleIds.length; i++) {
      const enqueued = await this.enqueue(userId, {
        articleIds: [articleIds[i]],
        scheduledAt: scheduleTimes[i].toISOString(),
        timezone,
      });
      jobs.push(...enqueued.data.jobs);
    }

    return {
      data: {
        siteId: dto.siteId,
        siteName: site.name,
        scheduledAt: startAt.toISOString(),
        timezone,
        intervalMinutes: dto.intervalMinutes ?? 0,
        resolved,
        jobs,
      },
    };
  }

  async list(userId: string) {
    const jobs = await this.prisma.publishJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 150,
      include: {
        article: {
          select: {
            id: true,
            title: true,
            status: true,
            publishAt: true,
            wpUrl: true,
            errorMessage: true,
          },
        },
        site: {
          select: { id: true, name: true, url: true },
        },
      },
    });
    return { data: jobs };
  }

  async getProgress(userId: string, jobId: string) {
    const job = await this.getOwnedJob(userId, jobId);
    return {
      data: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        attempts: job.attempts,
        error: job.error,
        scheduledAt: job.scheduledAt,
      },
    };
  }

  async pause(userId: string, jobId: string) {
    const job = await this.getOwnedJob(userId, jobId);
    try {
      if (job.bullJobId && this.redisAvailable) {
        const bullJob = await this.publishQueue.getJob(job.bullJobId);
        await bullJob?.updateData({ ...bullJob.data, paused: true });
      }
    } catch (err) {
      this.logger.warn(`Pause bull job failed: ${err.message}`);
    }

    const updated = await this.prisma.publishJob.update({
      where: { id: jobId },
      data: { status: JobStatus.PAUSED },
    });
    return { data: updated };
  }

  async resume(userId: string, jobId: string) {
    const job = await this.getOwnedJob(userId, jobId);
    try {
      if (this.redisAvailable) {
        await this.publishQueue.add(
          'publish-article',
          {
            publishJobId: job.id,
            articleId: job.articleId,
            userId: job.userId,
            siteId: job.siteId,
          },
          { attempts: job.maxAttempts },
        );
      }
    } catch (err) {
      this.logger.warn(`Resume bull job failed: ${err.message}`);
    }

    const updated = await this.prisma.publishJob.update({
      where: { id: jobId },
      data: {
        status:
          job.scheduledAt && job.scheduledAt > new Date()
            ? JobStatus.DELAYED
            : JobStatus.WAITING,
      },
    });
    return { data: updated };
  }

  async retry(userId: string, jobId: string) {
    const job = await this.getOwnedJob(userId, jobId);
    return this.enqueue(userId, {
      articleIds: [job.articleId],
      delayMs: this.defaultDelayMs,
    });
  }

  async cancel(userId: string, jobId: string) {
    const job = await this.getOwnedJob(userId, jobId);
    try {
      if (job.bullJobId && this.redisAvailable) {
        const bullJob = await this.publishQueue.getJob(job.bullJobId);
        await bullJob?.remove();
      }
    } catch (err) {
      this.logger.warn(`Cancel bull job failed: ${err.message}`);
    }

    const updated = await this.prisma.publishJob.update({
      where: { id: jobId },
      data: { status: JobStatus.CANCELLED },
    });
    await this.prisma.article.update({
      where: { id: job.articleId },
      data: { status: ArticleStatus.CANCELLED },
    });
    return { data: updated };
  }

  /** Cancel all active/scheduled jobs for this user in one go. */
  async cancelAll(userId: string) {
    const jobs = await this.prisma.publishJob.findMany({
      where: {
        userId,
        status: {
          in: [
            JobStatus.WAITING,
            JobStatus.DELAYED,
            JobStatus.PAUSED,
            JobStatus.ACTIVE,
          ],
        },
      },
      select: { id: true },
    });

    let cancelled = 0;
    for (const job of jobs) {
      try {
        await this.cancel(userId, job.id);
        cancelled += 1;
      } catch (err) {
        this.logger.warn(
          `cancelAll skipped ${job.id}: ${(err as Error).message}`,
        );
      }
    }

    return { data: { cancelled, total: jobs.length } };
  }

  async pauseQueue() {
    try {
      await this.publishQueue.pause();
      return { data: { paused: true } };
    } catch (err) {
      this.logger.warn(`pauseQueue: ${err.message}`);
      return { data: { paused: false, warning: err.message } };
    }
  }

  async resumeQueue() {
    try {
      await this.publishQueue.resume();
      return { data: { resumed: true } };
    } catch (err) {
      this.logger.warn(`resumeQueue: ${err.message}`);
      return { data: { resumed: false, warning: err.message } };
    }
  }

  setSpeed(delayMs: number) {
    this.defaultDelayMs = delayMs;
    return { data: { delayMs: this.defaultDelayMs } };
  }

  getSpeed() {
    return { data: { delayMs: this.defaultDelayMs } };
  }

  /** Runs due WAITING/DELAYED jobs from DB (works without Redis). */
  async processDueJobs() {
    if (this.processingDue) return;
    this.processingDue = true;
    try {
      const now = new Date();
      const due = await this.prisma.publishJob.findMany({
        where: {
          status: { in: [JobStatus.WAITING, JobStatus.DELAYED] },
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
        },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
      });

      for (const job of due) {
        // If BullMQ owns this job, skip — worker will handle it
        if (this.redisAvailable && job.bullJobId) continue;

        await this.prisma.publishJob.update({
          where: { id: job.id },
          data: {
            status: JobStatus.ACTIVE,
            attempts: { increment: 1 },
            progress: 10,
          },
        });

        try {
          await this.publishing.publish(job.userId, job.articleId);
          try {
            await this.prisma.publishJob.update({
              where: { id: job.id },
              data: {
                status: JobStatus.COMPLETED,
                progress: 100,
                error: null,
              },
            });
          } catch {
            /* job/article may be removed after publish */
          }
        } catch (err) {
          this.logger.error(
            `Due job ${job.id} failed: ${(err as Error).message}`,
          );
          await this.prisma.publishJob.update({
            where: { id: job.id },
            data: {
              status: JobStatus.FAILED,
              error: (err as Error).message,
              progress: 0,
            },
          });
          await this.prisma.article.update({
            where: { id: job.articleId },
            data: {
              status: ArticleStatus.FAILED,
              errorMessage: (err as Error).message,
            },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`processDueJobs: ${(err as Error).message}`);
    } finally {
      this.processingDue = false;
    }
  }

  private async getOwnedJob(userId: string, id: string) {
    const job = await this.prisma.publishJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.userId !== userId) throw new ForbiddenException('Access denied');
    return job;
  }
}
