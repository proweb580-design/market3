import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { requestId } from './common/request-id.middleware.js';
import { ENV, type Env } from './config/env.js';
import { ConfigModule } from './config/config.module.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { PermissionsGuard } from './modules/access/permissions.guard.js';
import { TenantGuard } from './modules/access/tenant.guard.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { ApiKeysModule } from './modules/api-keys/api-keys.module.js';
import { ApiLogMiddleware } from './modules/api-keys/api-log.middleware.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BuyersModule } from './modules/buyers/buyers.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { SubscriptionGuard } from './modules/billing/subscription.guard.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { TelegramModule } from './modules/telegram/telegram.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { RbacModule } from './modules/rbac/rbac.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [{ ttl: 60_000, limit: env.THROTTLE_LIMIT }],
    }),
    AuditModule,
    AccessModule,
    AuthModule,
    BillingModule,
    TelegramModule,
    UsersModule,
    ProfilesModule,
    RbacModule,
    OrganizationsModule,
    ApiKeysModule,
    AdminModule,
    CatalogModule,
    OrdersModule,
    SupportModule,
    JobsModule,
    BuyersModule,
    MediaModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: rate limit → authenticate → resolve tenant → authorize (role) → plan allows it.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useExisting: SubscriptionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestId, ApiLogMiddleware).forRoutes('{*path}');
  }
}
