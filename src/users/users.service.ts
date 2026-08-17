import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UserStatus } from '../common/enums';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
    if (!user || user.status === UserStatus.DELETED) {
      throw new NotFoundException('User not found');
    }
    const { passwordHash: _, ...safe } = user;
    return { data: safe };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.preferences !== undefined && {
          preferences: dto.preferences as Prisma.InputJsonValue,
        }),
      },
    });
    const { passwordHash: _, ...safe } = user;
    return { data: safe };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Account uses social login; set a password first via reset',
      );
    }

    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.prisma.refreshToken.deleteMany({ where: { userId } });

    return { data: { success: true } };
  }

  async updatePreferences(
    userId: string,
    preferences: Record<string, unknown>,
  ) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: preferences as Prisma.InputJsonValue },
    });
    return { data: { preferences: user.preferences } };
  }

  async deleteAccount(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        status: UserStatus.DELETED,
        email: `deleted_${userId}@deleted.local`,
        passwordHash: null,
        googleId: null,
      },
    });
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    return { data: { deleted: true } };
  }

  async getAccountStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        status: true,
        emailVerifiedAt: true,
        role: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            articleLimit: true,
            articlesUsed: true,
            websiteLimit: true,
            periodEnd: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return { data: user };
  }
}
