import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChangePlanDto } from './dto/subscription.dto';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get('plans')
  getPlans() {
    return this.subscriptionsService.getPlans();
  }

  @Get('status')
  getStatus(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getStatus(userId);
  }

  @Get('usage')
  getUsage(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.checkLimits(userId);
  }

  @Get('billing')
  billingHistory(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.billingHistory(userId);
  }

  @Post('change-plan')
  changePlan(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePlanDto,
  ) {
    return this.subscriptionsService.changePlan(userId, dto.plan);
  }
}
