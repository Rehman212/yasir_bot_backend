import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType, SubscriptionStatus } from '../common/enums';

const PLAN_LIMITS: Record<
  PlanType,
  { articleLimit: number; websiteLimit: number; price: number }
> = {
  [PlanType.FREE]: { articleLimit: 50, websiteLimit: 1, price: 0 },
  [PlanType.STARTER]: { articleLimit: 500, websiteLimit: 3, price: 19 },
  [PlanType.PROFESSIONAL]: { articleLimit: 5000, websiteLimit: 10, price: 49 },
  [PlanType.AGENCY]: { articleLimit: 50000, websiteLimit: 100, price: 149 },
};

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  getPlans() {
    return {
      data: Object.entries(PLAN_LIMITS).map(([plan, limits]) => ({
        plan,
        ...limits,
        currency: 'USD',
      })),
    };
  }

  async getStatus(userId: string) {
    let sub = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    if (!sub) {
      sub = await this.prisma.subscription.create({
        data: {
          userId,
          plan: PlanType.FREE,
          status: SubscriptionStatus.ACTIVE,
          articleLimit: PLAN_LIMITS.FREE.articleLimit,
          websiteLimit: PLAN_LIMITS.FREE.websiteLimit,
          articlesUsed: 0,
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    const sitesCount = await this.prisma.wordPressSite.count({
      where: { userId },
    });

    return {
      data: {
        ...sub,
        usage: {
          articlesUsed: sub.articlesUsed,
          articleLimit: sub.articleLimit,
          websitesUsed: sitesCount,
          websiteLimit: sub.websiteLimit,
        },
      },
    };
  }

  async changePlan(userId: string, plan: PlanType) {
    const limits = PLAN_LIMITS[plan];
    const sub = await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan,
        status: SubscriptionStatus.ACTIVE,
        articleLimit: limits.articleLimit,
        websiteLimit: limits.websiteLimit,
        articlesUsed: 0,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: {
        plan,
        status: SubscriptionStatus.ACTIVE,
        articleLimit: limits.articleLimit,
        websiteLimit: limits.websiteLimit,
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    // Billing stub
    if (limits.price > 0) {
      await this.prisma.billingHistory.create({
        data: {
          subscriptionId: sub.id,
          amount: limits.price,
          currency: 'USD',
          description: `Plan change to ${plan} (stub)`,
          paidAt: new Date(),
        },
      });
    }

    return { data: sub };
  }

  async billingHistory(userId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    if (!sub) throw new NotFoundException('Subscription not found');

    const history = await this.prisma.billingHistory.findMany({
      where: { subscriptionId: sub.id },
      orderBy: { paidAt: 'desc' },
    });
    return { data: history };
  }

  async checkLimits(userId: string) {
    const status = await this.getStatus(userId);
    const { articlesUsed, articleLimit, websitesUsed, websiteLimit } =
      status.data.usage;
    return {
      data: {
        canPublish: articlesUsed < articleLimit,
        canAddSite: websitesUsed < websiteLimit,
        ...status.data.usage,
      },
    };
  }
}
