import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ArticleStatus, JobStatus } from '../common/enums';
import { EnqueueArticlesDto } from './dto/queue.dto';

export const PUBLISH_QUEUE = 'publish';

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);
  private redisAvailable = true;
  private defaultDelayMs = 2000;

  constructor(
    @InjectQueue(PUBLISH_QUEUE) private readonly publishQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      const client = await (this.publishQueue as any).client;
      if (client?.status === 'ready' || client?.ping) {
        await client.ping?.();
      }
      this.logger.log('BullMQ publish queue connected');
    } catch (err) {
      this.redisAvailable = false;
      this.logger.warn(
        `Redis unavailable — queue API will log warnings: ${err.message}`,
      );
    }
  }

  async enqueue(userId: string, dto: EnqueueArticlesDto) {
    const jobs: Array<Record<string, unknown>> = [];
    let delayOffset = 0;
    const perJobDelay = dto.delayMs ?? this.defaultDelayMs;

    for (const articleId of dto.articleIds) {
      const article = await this.prisma.article.findUnique({
        where: { id: articleId },
      });
      if (!article || article.userId !== userId) {
        jobs.push({ articleId, error: 'Not found or access denied' });
        continue;
      }

      const scheduledAt = dto.scheduledAt
        ? new Date(dto.scheduledAt)
        : null;
      const delay =
        scheduledAt && scheduledAt > new Date()
          ? scheduledAt.getTime() - Date.now()
          : delayOffset;

      const publishJob = await this.prisma.publishJob.create({
        data: {
          articleId,
          siteId: article.siteId,
          userId,
          status: delay > 0 ? JobStatus.DELAYED : JobStatus.WAITING,
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
            `Redis down — job ${publishJob.id} stored in DB only`,
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
            status: scheduledAt
              ? ArticleStatus.SCHEDULED
              : ArticleStatus.QUEUED,
          },
        });

        jobs.push({ articleId, jobId: publishJob.id, delay });
      } catch (err) {
        this.redisAvailable = false;
        this.logger.warn(`Failed to enqueue bull job: ${err.message}`);
        jobs.push({ articleId, jobId: publishJob.id, warning: err.message });
      }

      delayOffset += perJobDelay;
    }

    return { data: { jobs, delayMs: perJobDelay } };
  }

  async list(userId: string) {
    const jobs = await this.prisma.publishJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
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
      data: { status: JobStatus.WAITING },
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

  private async getOwnedJob(userId: string, id: string) {
    const job = await this.prisma.publishJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.userId !== userId) throw new ForbiddenException('Access denied');
    return job;
  }
}
