import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { SiteSettingsService } from '../site-settings/site-settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PlanType, UserRole, UserStatus } from '../common/enums';
import { APP_FEATURES } from '../common/features';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly siteSettings: SiteSettingsService,
  ) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('features')
  listFeatures() {
    return { data: APP_FEATURES };
  }

  @Get('site-settings')
  getSiteSettings() {
    return this.siteSettings.getPublic();
  }

  @Patch('site-settings')
  updateSiteSettings(
    @Body()
    body: {
      companyName?: string;
      companyUrl?: string;
      companyDisplay?: string;
      whatsappNumber?: string;
      promoPopupEnabled?: boolean;
    },
  ) {
    return this.siteSettings.update(body);
  }

  @Get('users')
  listUsers(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.adminService.listUsers(Number(page) || 1, Number(limit) || 20);
  }

  @Post('users')
  createUser(
    @Body()
    body: {
      email: string;
      name: string;
      password: string;
      role?: UserRole;
      deniedFeatures?: string[];
      expiryDays?: number | null;
    },
  ) {
    return this.adminService.createUser(body);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.adminService.deleteUser(id, actorId);
  }

  @Patch('users/:id/status')
  updateUserStatus(
    @Param('id') id: string,
    @Body('status') status: UserStatus,
  ) {
    return this.adminService.updateUserStatus(id, status);
  }

  @Patch('users/:id/role')
  updateUserRole(@Param('id') id: string, @Body('role') role: UserRole) {
    return this.adminService.updateUserRole(id, role);
  }

  @Patch('users/:id/permissions')
  updateUserPermissions(
    @Param('id') id: string,
    @Body('deniedFeatures') deniedFeatures: string[],
  ) {
    return this.adminService.updateUserDeniedFeatures(id, deniedFeatures || []);
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
