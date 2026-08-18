import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  DeliveryAttemptEntity,
  AuditEventEntity,
  IdempotencyRecordEntity,
  InvoiceEntity,
  InvoiceLineEntity,
  MerchantEntity,
  OutboxEventEntity,
  PaymentEntity,
  PaymentWebhookReceiptEntity,
  RefundEntity,
  StoreEntity,
  databaseOptions
} from "@merchant-platform/persistence";
import { DevAuthController } from "./auth/dev-auth.controller.js";
import { AuditController } from "./audit/audit.controller.js";
import { AuditService } from "./audit/audit.service.js";
import { LoggingInterceptor } from "./common/logging.interceptor.js";
import { PlatformAuthGuard } from "./common/platform-auth.guard.js";
import { RequestContextMiddleware } from "./common/request-context.middleware.js";
import { API_CONFIG, loadApiConfig } from "./config.js";
import { HealthController } from "./health/health.controller.js";
import { InvoiceController } from "./invoices/invoice.controller.js";
import { InvoiceService } from "./invoices/invoice.service.js";
import { MerchantScopeService } from "./invoices/merchant-scope.service.js";
import { OpsController } from "./ops/ops.controller.js";
import { MerchantController } from "./merchants/merchant.controller.js";
import { PaymentController } from "./payments/payment.controller.js";
import { PaymentService } from "./payments/payment.service.js";
import { TelemetryController } from "./telemetry/telemetry.controller.js";
import { TelemetryService } from "./telemetry/telemetry.service.js";

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions(process.env)),
    TypeOrmModule.forFeature([
      MerchantEntity, StoreEntity, InvoiceEntity, InvoiceLineEntity,
      IdempotencyRecordEntity, OutboxEventEntity, DeliveryAttemptEntity,
      PaymentEntity, RefundEntity, PaymentWebhookReceiptEntity, AuditEventEntity
    ])
  ],
  controllers: [
    HealthController,
    TelemetryController,
    DevAuthController,
    InvoiceController,
    MerchantController,
    PaymentController,
    AuditController,
    OpsController
  ],
  providers: [
    { provide: API_CONFIG, useFactory: () => loadApiConfig(process.env) },
    TelemetryService,
    MerchantScopeService,
    AuditService,
    InvoiceService,
    PaymentService,
    { provide: APP_GUARD, useClass: PlatformAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
