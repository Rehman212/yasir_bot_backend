import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  PlanType,
  SubscriptionStatus,
  UserRole,
  UserStatus,
} from '../common/enums';
import { SignupDto } from './dto/signup.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly bcryptRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return null;
    if (user.status !== UserStatus.ACTIVE) return null;

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return null;

    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
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
    });

    await this.sendVerificationEmail(user.id, user.email);
    const tokens = await this.issueTokens(user.id, user.email, user.role);

    return {
      data: {
        user: this.sanitizeUser(user),
        ...tokens,
      },
    };
  }

  async login(user: {
    id: string;
    email: string;
    role: string;
    name: string;
    status: string;
  }) {
    const tokens = await this.issueTokens(user.id, user.email, user.role);
    return {
      data: {
        user: this.sanitizeUser(user),
        ...tokens,
      },
    };
  }

  async logout(userId: string, refreshToken?: string) {
    if (refreshToken) {
      const hash = this.hashToken(refreshToken);
      await this.prisma.refreshToken.deleteMany({
        where: { userId, tokenHash: hash },
      });
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }
    return { data: { success: true } };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; role: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret:
          this.config.get<string>('JWT_REFRESH_SECRET') ||
          this.config.get<string>('JWT_SECRET') ||
          'dev-jwt-secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash: hash },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    await this.prisma.refreshToken.delete({ where: { id: stored.id } });
    const tokens = await this.issueTokens(
      payload.sub,
      payload.email,
      payload.role,
    );
    return { data: tokens };
  }

  async verifyEmail(token: string) {
    const hash = this.hashToken(token);
    const record = await this.prisma.emailVerificationToken.findFirst({
      where: { tokenHash: hash },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.delete({ where: { id: record.id } }),
    ]);

    return { data: { verified: true } };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success to avoid email enumeration
    if (!user) {
      return { data: { sent: true } };
    }

    const raw = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(raw);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    this.logger.log(`[DEV] Password reset token for ${email}: ${raw}`);
    return { data: { sent: true } };
  }

  async resetPassword(token: string, password: string) {
    const hash = this.hashToken(token);
    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash: hash },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(password, this.bcryptRounds);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.delete({ where: { id: record.id } }),
      this.prisma.refreshToken.deleteMany({ where: { userId: record.userId } }),
    ]);

    return { data: { reset: true } };
  }

  async handleGoogleUser(profile: {
    googleId: string;
    email?: string;
    name?: string;
  }) {
    if (!profile.email) {
      throw new BadRequestException('Google account has no email');
    }

    let user = await this.prisma.user.findFirst({
      where: {
        OR: [{ googleId: profile.googleId }, { email: profile.email }],
      },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email.toLowerCase(),
          name: profile.name || profile.email.split('@')[0],
          googleId: profile.googleId,
          emailVerifiedAt: new Date(),
          role: UserRole.USER,
          status: UserStatus.ACTIVE,
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
      });
    } else if (!user.googleId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: profile.googleId,
          emailVerifiedAt: user.emailVerifiedAt || new Date(),
        },
      });
    }

    const tokens = await this.issueTokens(user.id, user.email, user.role);
    return {
      data: {
        user: this.sanitizeUser(user),
        ...tokens,
      },
    };
  }

  private async sendVerificationEmail(userId: string, email: string) {
    const raw = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(raw);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    this.logger.log(`[DEV] Email verification token for ${email}: ${raw}`);
  }

  private async issueTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET') || 'dev-jwt-secret',
      expiresIn: '15m',
    });

    const refreshToken = this.jwt.sign(payload, {
      secret:
        this.config.get<string>('JWT_REFRESH_SECRET') ||
        this.config.get<string>('JWT_SECRET') ||
        'dev-jwt-secret',
      expiresIn: '7d',
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return { accessToken, refreshToken, expiresIn: 900 };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private sanitizeUser(user: Record<string, any>) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
