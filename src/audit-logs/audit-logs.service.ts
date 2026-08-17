import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction } from '../common/enums';
import { AuditLogQueryDto, CreateAuditLogDto } from './dto/audit-log.dto';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async log(userId: string | null, dto: CreateAuditLogDto) {
    const entry = await this.prisma.auditLog.create({
      data: {
        userId: userId || null,
        action: dto.action,
        entity: dto.entity,
        entityId: dto.entityId,
        metadata: (dto.metadata || {}) as Prisma.InputJsonValue,
        ip: dto.ip,
      },
    });
    return { data: entry };
  }

  async logActivity(
    userId: string | null,
    action: AuditAction,
    entity: string,
    entityId?: string,
    metadata?: Record<string, unknown>,
    ip?: string,
  ) {
    return this.log(userId, { action, entity, entityId, metadata, ip });
  }

  async list(query: AuditLogQueryDto, restrictUserId?: string) {
    const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '50', 10) || 50));

    const where: Prisma.AuditLogWhereInput = {};
    if (restrictUserId) where.userId = restrictUserId;
    else if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.entity) where.entity = query.entity;

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: items,
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    };
  }
}
