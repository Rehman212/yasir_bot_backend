import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { QueueService } from './queue.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EnqueueArticlesDto, SpeedControlDto } from './dto/queue.dto';

@Controller('queue')
@UseGuards(JwtAuthGuard)
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post('enqueue')
  enqueue(
    @CurrentUser('id') userId: string,
    @Body() dto: EnqueueArticlesDto,
  ) {
    return this.queueService.enqueue(userId, dto);
  }

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.queueService.list(userId);
  }

  @Get('speed')
  getSpeed() {
    return this.queueService.getSpeed();
  }

  @Post('speed')
  setSpeed(@Body() dto: SpeedControlDto) {
    return this.queueService.setSpeed(dto.delayMs);
  }

  @Post('pause-all')
  pauseQueue() {
    return this.queueService.pauseQueue();
  }

  @Post('resume-all')
  resumeQueue() {
    return this.queueService.resumeQueue();
  }

  @Get(':id/progress')
  progress(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.queueService.getProgress(userId, id);
  }

  @Post(':id/pause')
  pause(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.queueService.pause(userId, id);
  }

  @Post(':id/resume')
  resume(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.queueService.resume(userId, id);
  }

  @Post(':id/retry')
  retry(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.queueService.retry(userId, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.queueService.cancel(userId, id);
  }
}
