import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PlanType, UserRole, UserStatus } from '../common/enums';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  listUsers(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.adminService.listUsers(page || 1, limit || 20);
  }

  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body('status') status: UserStatus,
  ) {
    return this.adminService.updateUserStatus(id, status);
  }

  @Patch('users/:id/plan')
  updateUserPlan(@Param('id') id: string, @Body('plan') plan: PlanType) {
    return this.adminService.updateUserPlan(id, plan);
  }

  @Get('support')
  listSupport() {
    return this.adminService.listSupportRequests();
  }

  @Patch('support/:id/resolve')
  resolveSupport(@Param('id') id: string) {
    return this.adminService.resolveSupport(id);
  }
}
