import { Module, Logger, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService, PUBLISH_QUEUE } from './queue.service';
import { QueueController } from './queue.controller';
import { PublishProcessor } from './processors/publish.processor';
import { PublishingModule } from '../publishing/publishing.module';

const redisEnabled = process.env.REDIS_ENABLED !== 'false';

const mockQueueProvider = {
  provide: `BullQueue_${PUBLISH_QUEUE}`,
  useValue: {
    add: async () => {
      throw new Error('Redis disabled');
    },
    getJob: async () => null,
    pause: async () => undefined,
    resume: async () => undefined,
  },
};

if (!redisEnabled) {
  new Logger('QueueModule').warn(
    'REDIS_ENABLED=false — BullMQ disabled; jobs stay in DB only',
  );
}

@Module({
  imports: [
    ...(redisEnabled
      ? [
          BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              connection: {
                host: config.get<string>('REDIS_HOST') || '127.0.0.1',
                port: parseInt(
                  config.get<string>('REDIS_PORT') || '6379',
                  10,
                ),
                maxRetriesPerRequest: null,
              },
            }),
          }),
          BullModule.registerQueue({ name: PUBLISH_QUEUE }),
        ]
      : []),
    forwardRef(() => PublishingModule),
  ],
  controllers: [QueueController],
  providers: [
    QueueService,
    ...(redisEnabled ? [PublishProcessor] : [mockQueueProvider]),
  ],
  exports: [QueueService],
})
export class QueueModule {}
