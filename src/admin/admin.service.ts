import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  PlanType,
  SupportStatus,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '../common/enums';
import { APP_FEATURES } from '../common/features';

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureBootstrapAdmin();
  }

  /** Creates / promotes the configured bootstrap admin if missing. */
  private async ensureBootstrapAdmin() {
    const email = (
      process.env.BOOTSTRAP_ADMIN_EMAIL || 'Rehmanwebs@gmail.com'
    ).toLowerCase();
    const password =
      process.env.BOOTSTRAP_ADMIN_PASSWORD || '786786786';
    const name = process.env.BOOTSTRAP_ADMIN_NAME || 'Rehman Webs';

    const existing = await this.prisma.user.findUnique({ where: { email } });
    const passwordHash = await bcrypt.hash(password, 12);

    if (!existing) {
      await this.prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
          deniedFeatures: [],
          preferences: {},
          subscription: {
            create: {
              plan: PlanType.AGENCY,
              status: SubscriptionStatus.ACTIVE,
              articleLimit: 999999,
              websiteLimit: 999999,
              articlesUsed: 0,
              periodStart: new Date(),
              periodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            },
          },
        },
      });
      this.logger.log(`Bootstrap admin created: ${email}`);
      return;
    }

    await this.prisma.user.update({
      where: { id: existing.id },
      data: {
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        passwordHash,
        deniedFeatures: [],
        emailVerifiedAt: existing.emailVerifiedAt || new Date(),
      },
    });
    this.logger.log(`Bootstrap admin ensured: ${email}`);
  }

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
      this.prisma.wordPressSite.aggregate({
        _sum: { publishedCount: true },
      }),
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
        articlesPublished: articlesPublished._sum.publishedCount || 0,
        failedJobs,
        openSupport,
        queueStatus: Object.fromEntries(
          queueByStatus.map((q) => [q.status, q._count]),
        ),
        features: APP_FEATURES,
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
          deniedFeatures: true,
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

  async createUser(input: {
    email: string;
    name: string;
    password: string;
    role?: UserRole;
    deniedFeatures?: string[];
  }) {
    const email = input.email.toLowerCase().trim();
    if (!email || !input.name?.trim() || !input.password) {
      throw new BadRequestException('email, name, and password are required');
    }
    if (input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const deniedFeatures = this.normalizeDenied(input.deniedFeatures);
    const role = input.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.USER;
    const passwordHash = await bcrypt.hash(input.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash,
        role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        deniedFeatures: role === UserRole.ADMIN ? [] : deniedFeatures,
        preferences: {},
        subscription: {
          create: {
            plan: PlanType.FREE,
            status: SubscriptionStatus.ACTIVE,
            articleLimit: 50,
            websiteLimit: 1,
            articlesUsed: 0,
            periodStart: new Date(),
            periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        deniedFeatures: true,
        createdAt: true,
      },
    });

    return { data: user };
  }

  async updateUserRole(userId: string, role: UserRole) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.role === UserRole.ADMIN && role !== UserRole.ADMIN) {
      const adminCount = await this.prisma.user.count({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      });
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot demote the last admin');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        role,
        ...(role === UserRole.ADMIN ? { deniedFeatures: [] } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        deniedFeatures: true,
      },
    });
    return { data: updated };
  }

  async updateUserDeniedFeatures(userId: string, deniedFeatures: string[]) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException('Admins cannot have denied features');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { deniedFeatures: this.normalizeDenied(deniedFeatures) },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        deniedFeatures: true,
      },
    });
    return { data: updated };
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
        deniedFeatures: true,
      },
    });
    return { data: updated };
  }

  async updateUserPlan(userId: string, plan: PlanType) {
    const limits: Record<
      PlanType,
      { articleLimit: number; websiteLimit: number }
    > = {
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

  private normalizeDenied(features?: string[]) {
    if (!features?.length) return [];
    const allowed = new Set<string>(APP_FEATURES);
    return [...new Set(features.filter((f) => allowed.has(f)))];
  }
}
