import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '../common/enums';
import { CreateNotificationDto } from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const host = this.config.get<string>('SMTP_HOST');
    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: parseInt(this.config.get<string>('SMTP_PORT') || '587', 10),
        secure: false,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
  }

  async create(userId: string, dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        meta: (dto.meta || {}) as Prisma.InputJsonValue,
      },
    });
    return { data: notification };
  }

  async list(userId: string, unreadOnly = false) {
    const items = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly && { readAt: null }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: items };
  }

  async markRead(userId: string, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== userId) throw new ForbiddenException('Access denied');

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return { data: updated };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { data: { success: true } };
  }

  async remove(userId: string, id: string) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== userId) throw new ForbiddenException('Access denied');
    await this.prisma.notification.delete({ where: { id } });
    return { data: { deleted: true } };
  }

  async sendImportCompletedEmail(userId: string, filename: string, count: number) {
    return this.sendEmailStub(
      userId,
      NotificationType.IMPORT_COMPLETED,
      'Import completed',
      `Your import of ${filename} finished with ${count} articles.`,
    );
  }

  async sendPublishCompletedEmail(userId: string, title: string, url?: string) {
    return this.sendEmailStub(
      userId,
      NotificationType.PUBLISH_COMPLETED,
      'Publish completed',
      `"${title}" was published${url ? `: ${url}` : ''}.`,
    );
  }

  private async sendEmailStub(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
  ) {
    await this.prisma.notification.create({
      data: { userId, type, title, message, meta: { email: true } },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { data: { sent: false } };

    if (!this.transporter) {
      this.logger.log(`[EMAIL STUB] To: ${user.email} | ${title} — ${message}`);
      return { data: { sent: false, stub: true } };
    }

    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM') || 'noreply@sheetpress.app',
        to: user.email,
        subject: title,
        text: message,
      });
      return { data: { sent: true } };
    } catch (err) {
      this.logger.warn(`Email send failed: ${err.message}`);
      return { data: { sent: false, error: err.message } };
    }
  }
}
