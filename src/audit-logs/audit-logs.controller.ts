import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateAuditLogDto, AuditLogQueryDto } from './dto/audit-log.dto';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query() query: AuditLogQueryDto,
  ) {
    return this.auditLogsService.list(query, userId);
  }

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAuditLogDto,
    @Req() req: any,
  ) {
    return this.auditLogsService.log(userId, {
      ...dto,
      ip: dto.ip || req.ip,
    });
  }
}
