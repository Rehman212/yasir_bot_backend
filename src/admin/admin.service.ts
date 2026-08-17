import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType, SupportStatus, UserStatus } from '../common/enums';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [
      totalUsers,
      activeSubscriptions,
      connectedWebsites,
      articlesPublished,
      failedJobs,
      openSupport,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.wordPressSite.count({ where: { status: 'CONNECTED' } }),
      this.prisma.article.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.publishJob.count({ where: { status: 'FAILED' } }),
      this.prisma.supportRequest.count({ where: { status: 'OPEN' } }),
    ]);

    const queueByStatus = await this.prisma.publishJob.groupBy({
      by: ['status'],
      _count: true,
    });

    return {
      data: {
        totalUsers,
        activeSubscriptions,
        connectedWebsites,
        articlesPublished,
        failedJobs,
        openSupport,
        queueStatus: Object.fromEntries(
          queueByStatus.map((q) => [q.status, q._count]),
        ),
      },
    };
  }

  async listUsers(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          createdAt: true,
          subscription: {
            select: { plan: true, status: true, articlesUsed: true },
          },
          _count: { select: { sites: true, articles: true } },
        },
      }),
      this.prisma.user.count(),
    ]);
    return { data: items, meta: { total, page, limit } };
  }

  async updateUserStatus(userId: string, status: UserStatus) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
      },
    });
    return { data: updated };
  }

  async updateUserPlan(userId: string, plan: PlanType) {
    const limits: Record<PlanType, { articleLimit: number; websiteLimit: number }> = {
      [PlanType.FREE]: { articleLimit: 10, websiteLimit: 1 },
      [PlanType.STARTER]: { articleLimit: 100, websiteLimit: 2 },
      [PlanType.PROFESSIONAL]: { articleLimit: 1000, websiteLimit: 10 },
      [PlanType.AGENCY]: { articleLimit: 999999, websiteLimit: 999999 },
    };

    const sub = await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan,
        ...limits[plan],
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: { plan, ...limits[plan] },
    });
    return { data: sub };
  }

  async listSupportRequests() {
    const items = await this.prisma.supportRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
    });
    return { data: items };
  }

  async resolveSupport(id: string) {
    const item = await this.prisma.supportRequest.update({
      where: { id },
      data: { status: SupportStatus.RESOLVED },
    });
    return { data: item };
  }
}
