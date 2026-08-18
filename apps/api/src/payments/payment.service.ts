import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import { verifyWebhookSignature } from "@merchant-platform/domain";
import {
  InvoiceEntity,
  InvoiceStatus,
  OutboxEventEntity,
  OutboxStatus,
  PaymentEntity,
  PaymentStatus,
  PaymentWebhookReceiptEntity,
  RefundEntity
} from "@merchant-platform/persistence";
import { InjectDataSource } from "@nestjs/typeorm";
import { createHash, randomUUID } from "node:crypto";
import { DataSource, In, type EntityManager } from "typeorm";
import { AuditService } from "../audit/audit.service.js";
import type { ApiConfig } from "../config.js";
import { MerchantScopeService } from "../invoices/merchant-scope.service.js";
import { TelemetryService } from "../telemetry/telemetry.service.js";
import type { PaymentWebhookDto } from "./payment-webhook.dto.js";

export interface PaymentWebhookResponse {
  providerEventId: string;
  duplicate: boolean;
  invoiceId?: string;
  invoiceStatus?: InvoiceStatus;
  paymentId?: string;
}

@Injectable()
export class PaymentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly merchantScope: MerchantScopeService,
    private readonly audit: AuditService,
    private readonly telemetry: TelemetryService
  ) {}

  async handleWebhook(
    config: ApiConfig,
    provider: string,
    timestamp: string,
    signature: string,
    rawBody: Buffer,
    dto: PaymentWebhookDto,
    requestId: string
  ): Promise<PaymentWebhookResponse> {
    if (provider !== config.paymentProvider) {
      throw new NotFoundException("Payment provider is not configured");
    }
    try {
      verifyWebhookSignature({
        rawBody,
        secret: config.paymentWebhookSecret,
        timestamp,
        signature,
        toleranceSeconds: config.paymentWebhookToleranceSeconds
      });
    } catch {
      this.telemetry.paymentWebhooks.inc({ outcome: "signature_rejected", event_type: dto.eventType });
      throw new UnauthorizedException("Invalid payment webhook signature");
    }

    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const occurredAt = new Date(dto.occurredAt).getTime();
    const now = Date.now();
    if (occurredAt > now + 5 * 60_000 || occurredAt < now - 90 * 24 * 60 * 60_000) {
      this.telemetry.paymentWebhooks.inc({ outcome: "invalid_event_time", event_type: dto.eventType });
      throw new BadRequestException("Payment event time is outside the accepted window");
    }
    try {
      const result = await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        const receipt = await manager.findOne(PaymentWebhookReceiptEntity, {
          where: { provider, providerEventId: dto.providerEventId }
        });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) {
            throw new ConflictException("Provider event ID was reused with a different payload");
          }
          return { providerEventId: dto.providerEventId, duplicate: true };
        }

        const response = dto.eventType === "payment.captured"
          ? await this.capture(manager, provider, dto, requestId)
          : await this.refund(manager, provider, dto, requestId);

        await manager.insert(PaymentWebhookReceiptEntity, {
          id: randomUUID(),
          provider,
          providerEventId: dto.providerEventId,
          eventType: dto.eventType,
          payloadHash
        });
        return response;
      });
      this.telemetry.paymentWebhooks.inc({
        outcome: result.duplicate ? "duplicate" : "accepted",
        event_type: dto.eventType
      });
      return result;
    } catch (error) {
      if (isDuplicateKey(error)) {
        const receipt = await this.dataSource.getRepository(PaymentWebhookReceiptEntity).findOne({
          where: { provider, providerEventId: dto.providerEventId }
        });
        if (receipt?.payloadHash === payloadHash) {
          this.telemetry.paymentWebhooks.inc({ outcome: "duplicate", event_type: dto.eventType });
          return { providerEventId: dto.providerEventId, duplicate: true };
        }
      }
      this.telemetry.paymentWebhooks.inc({ outcome: "rejected", event_type: dto.eventType });
      throw error;
    }
  }

  async list(actor: ActorTokenPayload, limit: number): Promise<PaymentEntity[]> {
    const merchantIds = await this.merchantScope.authorizedMerchantIds(
      this.dataSource.manager,
      actor.actorMerchantId
    );
    return this.dataSource.getRepository(PaymentEntity).find({
      where: { merchantId: In(merchantIds) },
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(limit, 1), 100)
    });
  }

  private async capture(
    manager: EntityManager,
    provider: string,
    dto: PaymentWebhookDto,
    requestId: string
  ): Promise<PaymentWebhookResponse> {
    const invoice = await this.lockInvoice(manager, dto.invoiceId);
    if (![InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID].includes(invoice.status)) {
      throw new ConflictException(`Invoice in ${invoice.status} state cannot accept a captured payment`);
    }
    if (invoice.currency !== dto.currency) throw new ConflictException("Payment currency does not match invoice");

    const duplicatePayment = await manager.findOne(PaymentEntity, {
      where: { provider, providerPaymentId: dto.providerPaymentId }
    });
    if (duplicatePayment) throw new ConflictException("Provider payment ID already exists");

    const alreadyCaptured = await capturedTotal(manager, invoice.id);
    if (alreadyCaptured + dto.amountMinor > invoice.totalMinor) {
      throw new ConflictException("Captured payment would exceed the invoice total");
    }
    const paymentId = randomUUID();
    await manager.insert(PaymentEntity, {
      id: paymentId,
      merchantId: invoice.merchantId,
      invoiceId: invoice.id,
      provider,
      providerPaymentId: dto.providerPaymentId,
      amountMinor: dto.amountMinor,
      refundedMinor: 0,
      currency: dto.currency,
      status: PaymentStatus.CAPTURED,
      capturedAt: new Date(dto.occurredAt)
    });

    const invoiceStatus = alreadyCaptured + dto.amountMinor === invoice.totalMinor
      ? InvoiceStatus.PAID
      : InvoiceStatus.PARTIALLY_PAID;
    await manager.createQueryBuilder().update(InvoiceEntity)
      .set({ status: invoiceStatus, version: () => "version + 1" })
      .where("id = :invoiceId", { invoiceId: invoice.id })
      .execute();
    await this.emit(manager, invoice, "payment.captured.v1", dto, invoiceStatus);
    await this.audit.record(manager, {
      merchantId: invoice.merchantId,
      actorSubject: `payment-provider:${provider}`,
      action: "payment.captured",
      resourceType: "payment",
      resourceId: paymentId,
      requestId,
      details: {
        invoiceId: invoice.id,
        providerEventId: dto.providerEventId,
        amountMinor: dto.amountMinor,
        currency: dto.currency
      }
    });
    return {
      providerEventId: dto.providerEventId,
      duplicate: false,
      invoiceId: invoice.id,
      invoiceStatus,
      paymentId
    };
  }

  private async refund(
    manager: EntityManager,
    provider: string,
    dto: PaymentWebhookDto,
    requestId: string
  ): Promise<PaymentWebhookResponse> {
    if (!dto.providerRefundId) throw new ConflictException("providerRefundId is required for refunds");
    const payment = await manager.createQueryBuilder(PaymentEntity, "payment")
      .setLock("pessimistic_write")
      .where("payment.provider = :provider", { provider })
      .andWhere("payment.provider_payment_id = :providerPaymentId", {
        providerPaymentId: dto.providerPaymentId
      })
      .getOne();
    if (!payment) throw new NotFoundException("Captured payment not found");
    const invoice = await this.lockInvoice(manager, dto.invoiceId);
    if (payment.invoiceId !== invoice.id) throw new ConflictException("Refund invoice does not match payment");
    if (![InvoiceStatus.PAID, InvoiceStatus.PARTIALLY_REFUNDED].includes(invoice.status)) {
      throw new ConflictException(`Invoice in ${invoice.status} state cannot accept a refund`);
    }
    if (payment.currency !== dto.currency) throw new ConflictException("Refund currency does not match payment");
    if (payment.refundedMinor + dto.amountMinor > payment.amountMinor) {
      throw new ConflictException("Refund would exceed the captured payment amount");
    }
    const duplicateRefund = await manager.findOne(RefundEntity, {
      where: { provider, providerRefundId: dto.providerRefundId }
    });
    if (duplicateRefund) throw new ConflictException("Provider refund ID already exists");

    const refundId = randomUUID();
    await manager.insert(RefundEntity, {
      id: refundId,
      merchantId: invoice.merchantId,
      paymentId: payment.id,
      provider,
      providerRefundId: dto.providerRefundId,
      amountMinor: dto.amountMinor,
      refundedAt: new Date(dto.occurredAt)
    });
    const paymentRefundedMinor = payment.refundedMinor + dto.amountMinor;
    const paymentStatus = paymentRefundedMinor === payment.amountMinor
      ? PaymentStatus.REFUNDED
      : PaymentStatus.PARTIALLY_REFUNDED;
    await manager.createQueryBuilder().update(PaymentEntity)
      .set({ refundedMinor: paymentRefundedMinor, status: paymentStatus, version: () => "version + 1" })
      .where("id = :paymentId AND version = :version", { paymentId: payment.id, version: payment.version })
      .execute();

    const totalCaptured = await capturedTotal(manager, invoice.id);
    const totalRefunded = await refundedTotal(manager, invoice.id);
    const invoiceStatus = totalRefunded === totalCaptured ? InvoiceStatus.REFUNDED : InvoiceStatus.PARTIALLY_REFUNDED;
    await manager.createQueryBuilder().update(InvoiceEntity)
      .set({ status: invoiceStatus, version: () => "version + 1" })
      .where("id = :invoiceId", { invoiceId: invoice.id })
      .execute();
    await this.emit(manager, invoice, "payment.refunded.v1", dto, invoiceStatus);
    await this.audit.record(manager, {
      merchantId: invoice.merchantId,
      actorSubject: `payment-provider:${provider}`,
      action: "payment.refunded",
      resourceType: "refund",
      resourceId: refundId,
      requestId,
      details: {
        invoiceId: invoice.id,
        paymentId: payment.id,
        providerEventId: dto.providerEventId,
        amountMinor: dto.amountMinor,
        currency: dto.currency
      }
    });
    return {
      providerEventId: dto.providerEventId,
      duplicate: false,
      invoiceId: invoice.id,
      invoiceStatus,
      paymentId: payment.id
    };
  }

  private async lockInvoice(manager: EntityManager, invoiceId: string): Promise<InvoiceEntity> {
    const invoice = await manager.createQueryBuilder(InvoiceEntity, "invoice")
      .setLock("pessimistic_write")
      .where("invoice.id = :invoiceId", { invoiceId })
      .getOne();
    if (!invoice) throw new NotFoundException("Invoice not found");
    return invoice;
  }

  private async emit(
    manager: EntityManager,
    invoice: InvoiceEntity,
    eventType: string,
    dto: PaymentWebhookDto,
    status: InvoiceStatus
  ): Promise<void> {
    const eventId = randomUUID();
    await manager.insert(OutboxEventEntity, {
      id: eventId,
      aggregateType: "invoice",
      aggregateId: invoice.id,
      merchantId: invoice.merchantId,
      eventType,
      payload: {
        eventId,
        invoiceId: invoice.id,
        merchantId: invoice.merchantId,
        storeId: invoice.storeId,
        customerName: invoice.customerName,
        customerContact: invoice.customerContact,
        currency: invoice.currency,
        totalMinor: invoice.totalMinor,
        status,
        issuedAt: invoice.issuedAt.toISOString(),
        providerEventId: dto.providerEventId,
        paymentAmountMinor: dto.amountMinor
      },
      status: OutboxStatus.PENDING,
      attempts: 0,
      availableAt: new Date(),
      lockUntil: null,
      publishedAt: null,
      lastError: null
    });
  }
}

async function capturedTotal(manager: EntityManager, invoiceId: string): Promise<number> {
  const row = await manager.createQueryBuilder(PaymentEntity, "payment")
    .select("COALESCE(SUM(payment.amount_minor), 0)", "total")
    .where("payment.invoice_id = :invoiceId", { invoiceId })
    .getRawOne<{ total: string }>();
  return Number(row?.total ?? 0);
}

async function refundedTotal(manager: EntityManager, invoiceId: string): Promise<number> {
  const row = await manager.createQueryBuilder(PaymentEntity, "payment")
    .select("COALESCE(SUM(payment.refunded_minor), 0)", "total")
    .where("payment.invoice_id = :invoiceId", { invoiceId })
    .getRawOne<{ total: string }>();
  return Number(row?.total ?? 0);
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY");
}
