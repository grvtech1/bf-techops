import { Controller, Get, Inject } from "@nestjs/common";
import {
  DeliveryAttemptEntity,
  DeliveryStatus,
  InvoiceEntity,
  OutboxEventEntity,
  OutboxStatus,
  PaymentEntity,
  RefundEntity
} from "@merchant-platform/persistence";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, In } from "typeorm";
import { Actor, RequireRoles } from "../common/http.js";
import { API_CONFIG, type ApiConfig } from "../config.js";
import { MerchantScopeService } from "../invoices/merchant-scope.service.js";

@Controller("v1/ops")
@RequireRoles("ops:read")
export class OpsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly merchantScope: MerchantScopeService,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  @Get("summary")
  async summary(@Actor() actor: ActorTokenPayload): Promise<Record<string, unknown>> {
    const merchantIds = await this.merchantScope.authorizedMerchantIds(
      this.dataSource.manager,
      actor.actorMerchantId
    );
    const [invoices, payments, refunds, pendingOutbox, processingOutbox, successfulDeliveries, deadLetters, oldest] = await Promise.all([
      this.dataSource.getRepository(InvoiceEntity).countBy({ merchantId: In(merchantIds) }),
      this.dataSource.getRepository(PaymentEntity).countBy({ merchantId: In(merchantIds) }),
      this.dataSource.getRepository(RefundEntity).countBy({ merchantId: In(merchantIds) }),
      this.dataSource.getRepository(OutboxEventEntity).countBy({
        merchantId: In(merchantIds), status: OutboxStatus.PENDING
      }),
      this.dataSource.getRepository(OutboxEventEntity).countBy({
        merchantId: In(merchantIds), status: OutboxStatus.PROCESSING
      }),
      this.deliveryCount(merchantIds, DeliveryStatus.SUCCEEDED),
      this.deliveryCount(merchantIds, DeliveryStatus.DEAD_LETTERED),
      this.dataSource.getRepository(OutboxEventEntity).findOne({
        where: { merchantId: In(merchantIds), status: OutboxStatus.PENDING },
        order: { createdAt: "ASC" }
      })
    ]);
    return {
      release: this.config.releaseVersion,
      environment: this.config.nodeEnv,
      invoices,
      payments,
      refunds,
      pendingOutbox,
      processingOutbox,
      successfulDeliveries,
      deadLetters,
      oldestPendingOutboxAt: oldest?.createdAt.toISOString() ?? null,
      generatedAt: new Date().toISOString()
    };
  }

  private deliveryCount(merchantIds: string[], status: DeliveryStatus): Promise<number> {
    return this.dataSource.getRepository(DeliveryAttemptEntity)
      .createQueryBuilder("delivery")
      .innerJoin(OutboxEventEntity, "event", "event.id = delivery.event_id")
      .where("event.merchant_id IN (:...merchantIds)", { merchantIds })
      .andWhere("delivery.status = :status", { status })
      .getCount();
  }
}
