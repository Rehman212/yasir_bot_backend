import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ScheduleBatchDto, RecoverMissedDto } from './dto/schedule.dto';

@Controller('scheduler')
@UseGuards(JwtAuthGuard)
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('batch')
  scheduleBatch(
    @CurrentUser('id') userId: string,
    @Body() dto: ScheduleBatchDto,
  ) {
    return this.schedulerService.scheduleBatch(userId, dto);
  }

  @Get()
  listScheduled(@CurrentUser('id') userId: string) {
    return this.schedulerService.listScheduled(userId);
  }

  @Post(':articleId/cancel')
  cancel(
    @CurrentUser('id') userId: string,
    @Param('articleId') articleId: string,
  ) {
    return this.schedulerService.cancelSchedule(userId, articleId);
  }

  @Post('recover')
  recover(
    @CurrentUser('id') userId: string,
    @Body() dto: RecoverMissedDto,
  ) {
    return this.schedulerService.recoverMissed(userId, dto.siteId);
  }

  @Get('recover')
  recoverGet(
    @CurrentUser('id') userId: string,
    @Query('siteId') siteId?: string,
  ) {
    return this.schedulerService.recoverMissed(userId, siteId);
  }
}
