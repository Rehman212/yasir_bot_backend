import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WordPressSitesModule } from './wordpress-sites/wordpress-sites.module';
import { WordPressIntegrationModule } from './wordpress-integration/wordpress-integration.module';
import { ImportsModule } from './imports/imports.module';
import { ArticlesModule } from './articles/articles.module';
import { MediaModule } from './media/media.module';
import { TaxonomyModule } from './taxonomy/taxonomy.module';
import { PublishingModule } from './publishing/publishing.module';
import { QueueModule } from './queue/queue.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SeoModule } from './seo/seo.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AdminModule } from './admin/admin.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CryptoModule,
    AuthModule,
    UsersModule,
    WordPressSitesModule,
    WordPressIntegrationModule,
    ImportsModule,
    ArticlesModule,
    MediaModule,
    TaxonomyModule,
    PublishingModule,
    QueueModule,
    SchedulerModule,
    SeoModule,
    NotificationsModule,
    SubscriptionsModule,
    AuditLogsModule,
    AdminModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
