import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishingService } from '../../publishing/publishing.service';
import { ArticleStatus, JobStatus, NotificationType } from '../../common/enums';
import { PUBLISH_QUEUE } from '../queue.service';

@Processor(PUBLISH_QUEUE)
export class PublishProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly publishing: PublishingService,
  ) {
    super();
  }

  async process(job: Job<{ publishJobId: string; articleId: string; userId: string }>) {
    const { publishJobId, articleId, userId } = job.data;
    this.logger.log(`Processing publish job ${publishJobId} for article ${articleId}`);

    const record = await this.prisma.publishJob.findUnique({
      where: { id: publishJobId },
    });
    if (!record || record.status === JobStatus.CANCELLED || record.status === JobStatus.PAUSED) {
      return { skipped: true };
    }

    await this.prisma.publishJob.update({
      where: { id: publishJobId },
      data: {
        status: JobStatus.ACTIVE,
        attempts: { increment: 1 },
        progress: 10,
      },
    });

    try {
      await job.updateProgress(30);
      const result = await this.publishing.publish(userId, articleId);

      await this.prisma.publishJob.update({
        where: { id: publishJobId },
        data: {
          status: JobStatus.COMPLETED,
          progress: 100,
          error: null,
        },
      });

      await job.updateProgress(100);
      return { success: true, articleId, wpUrl: result.data.wpUrl };
    } catch (err) {
      this.logger.error(`Publish failed for ${articleId}: ${err.message}`);

      await this.prisma.publishJob.update({
        where: { id: publishJobId },
        data: {
          status: JobStatus.FAILED,
          error: err.message,
          progress: 0,
        },
      });

      await this.prisma.article.update({
        where: { id: articleId },
        data: {
          status: ArticleStatus.FAILED,
          errorMessage: err.message,
        },
      });

      await this.prisma.notification.create({
        data: {
          userId,
          type: NotificationType.PUBLISH_FAILED,
          title: 'Publish failed',
          message: err.message,
          meta: { articleId, publishJobId },
        },
      });

      throw err;
    }
  }
}
