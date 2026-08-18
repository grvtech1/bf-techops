import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import { assertInvoiceTransition, calculateInvoice, normalizeIdempotencyKey, requestFingerprint } from "@merchant-platform/domain";
import {
  IdempotencyRecordEntity,
  InvoiceEntity,
  InvoiceLineEntity,
  InvoiceStatus,
  OutboxEventEntity,
  OutboxStatus
} from "@merchant-platform/persistence";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource, In, type EntityManager } from "typeorm";
import { TelemetryService } from "../telemetry/telemetry.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateInvoiceDto } from "./create-invoice.dto.js";
import { MerchantScopeService } from "./merchant-scope.service.js";
import { UpdateInvoiceStatusDto } from "./update-invoice-status.dto.js";

export interface InvoiceResponse {
  id: string;
  storeId: string;
  status: InvoiceStatus;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  issuedAt: string;
  version: number;
}

@Injectable()
export class InvoiceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly merchantScope: MerchantScopeService,
    private readonly audit: AuditService,
    private readonly telemetry: TelemetryService
  ) {}

  async create(
    actor: ActorTokenPayload,
    rawKey: string | undefined,
    requestId: string,
    dto: CreateInvoiceDto
  ): Promise<InvoiceResponse> {
    const idempotencyKey = domainInput(() => normalizeIdempotencyKey(rawKey));
    const fingerprint = requestFingerprint(dto);

    try {
      const result = await this.dataSource.transaction("READ COMMITTED", async (manager) => {
        const existing = await this.findIdempotency(manager, actor.actorMerchantId, idempotencyKey);
        if (existing) {
          if (existing.requestHash !== fingerprint) {
            throw new ConflictException("Idempotency key was already used with a different request");
          }
          return { response: existing.responseBody as unknown as InvoiceResponse, replayed: true };
        }

        const store = await this.merchantScope.authorizeStore(manager, actor.actorMerchantId, dto.storeId);
        const calculated = domainInput(() => calculateInvoice(dto));
        const invoiceId = randomUUID();
        const issuedAt = new Date();

        await manager.insert(InvoiceEntity, {
          id: invoiceId,
          merchantId: store.merchantId,
          storeId: store.id,
          createdBy: actor.subject ?? actor.actorMerchantId,
          customerName: dto.customerName.trim(),
          customerContact: dto.customerContact.toLowerCase(),
          currency: dto.currency,
          subtotalMinor: calculated.subtotalMinor,
          discountMinor: calculated.discountMinor,
          taxRateBasisPoints: calculated.taxRateBasisPoints,
          taxMinor: calculated.taxMinor,
          totalMinor: calculated.totalMinor,
          status: InvoiceStatus.ISSUED,
          issuedAt
        });
        await manager.insert(InvoiceLineEntity, calculated.items.map((item, index) => ({
          id: randomUUID(),
          invoiceId,
          position: index + 1,
          description: item.description,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          lineTotalMinor: item.lineTotalMinor
        })));

        const eventId = randomUUID();
        await manager.insert(OutboxEventEntity, {
          id: eventId,
          aggregateType: "invoice",
          aggregateId: invoiceId,
          merchantId: store.merchantId,
          eventType: "invoice.issued.v1",
          payload: {
            eventId,
            invoiceId,
            merchantId: store.merchantId,
            storeId: store.id,
            customerName: dto.customerName.trim(),
            customerContact: dto.customerContact.toLowerCase(),
            currency: dto.currency,
            totalMinor: calculated.totalMinor,
            status: InvoiceStatus.ISSUED,
            issuedAt: issuedAt.toISOString()
          },
          status: OutboxStatus.PENDING,
          attempts: 0,
          availableAt: issuedAt,
          lockUntil: null,
          publishedAt: null,
          lastError: null
        });

        const response: InvoiceResponse = {
          id: invoiceId,
          storeId: store.id,
          status: InvoiceStatus.ISSUED,
          currency: dto.currency,
          subtotalMinor: calculated.subtotalMinor,
          discountMinor: calculated.discountMinor,
          taxMinor: calculated.taxMinor,
          totalMinor: calculated.totalMinor,
          issuedAt: issuedAt.toISOString(),
          version: 1
        };
        await manager.insert(IdempotencyRecordEntity, {
          id: randomUUID(),
          actorMerchantId: actor.actorMerchantId,
          operation: "invoice.create",
          idempotencyKey,
          requestHash: fingerprint,
          responseStatus: 201,
          responseBody: response
        });
        await this.audit.record(manager, {
          merchantId: store.merchantId,
          actorSubject: actor.subject ?? actor.actorMerchantId,
          action: "invoice.created",
          resourceType: "invoice",
          resourceId: invoiceId,
          requestId,
          details: { storeId: store.id, currency: dto.currency, totalMinor: calculated.totalMinor }
        });
        return { response, replayed: false };
      });
      this.telemetry.invoices.inc({ outcome: result.replayed ? "replayed" : "created" });
      return result.response;
    } catch (error) {
      if (isDuplicateKey(error)) {
        const existing = await this.findIdempotency(this.dataSource.manager, actor.actorMerchantId, idempotencyKey);
        if (existing?.requestHash === fingerprint) {
          this.telemetry.invoices.inc({ outcome: "replayed" });
          return existing.responseBody as unknown as InvoiceResponse;
        }
        throw new ConflictException("Concurrent idempotency-key conflict");
      }
      this.telemetry.invoices.inc({ outcome: "failed" });
      throw error;
    }
  }

  async get(actor: ActorTokenPayload, invoiceId: string): Promise<InvoiceResponse> {
    const invoice = await this.dataSource.getRepository(InvoiceEntity).findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException("Invoice not found");
    await this.merchantScope.authorizeStore(this.dataSource.manager, actor.actorMerchantId, invoice.storeId);
    return toResponse(invoice);
  }

  async list(actor: ActorTokenPayload, limit: number): Promise<InvoiceResponse[]> {
    const merchantIds = await this.merchantScope.authorizedMerchantIds(
      this.dataSource.manager,
      actor.actorMerchantId
    );
    const invoices = await this.dataSource.getRepository(InvoiceEntity).find({
      where: { merchantId: In(merchantIds) },
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(limit, 1), 100)
    });
    return invoices.map(toResponse);
  }

  async transition(
    actor: ActorTokenPayload,
    invoiceId: string,
    requestId: string,
    dto: UpdateInvoiceStatusDto
  ): Promise<InvoiceResponse> {
    return this.dataSource.transaction("READ COMMITTED", async (manager) => {
      const invoice = await manager.findOne(InvoiceEntity, { where: { id: invoiceId } });
      if (!invoice) throw new NotFoundException("Invoice not found");
      await this.merchantScope.authorizeStore(manager, actor.actorMerchantId, invoice.storeId);
      try {
        assertInvoiceTransition(invoice.status, dto.status);
      } catch (error) {
        throw new ConflictException(error instanceof Error ? error.message : "Invalid invoice transition");
      }
      if (invoice.version !== dto.expectedVersion) {
        throw new ConflictException("Invoice was modified by another request; reload before retrying");
      }

      const result = await manager.createQueryBuilder()
        .update(InvoiceEntity)
        .set({ status: dto.status as InvoiceStatus, version: () => "version + 1" })
        .where("id = :invoiceId AND version = :version", { invoiceId, version: dto.expectedVersion })
        .execute();
      if (result.affected !== 1) {
        throw new ConflictException("Concurrent invoice update detected");
      }

      const eventId = randomUUID();
      await manager.insert(OutboxEventEntity, {
        id: eventId,
        aggregateType: "invoice",
        aggregateId: invoice.id,
        merchantId: invoice.merchantId,
        eventType: "invoice.status-changed.v1",
        payload: {
          eventId,
          invoiceId: invoice.id,
          merchantId: invoice.merchantId,
          storeId: invoice.storeId,
          customerName: invoice.customerName,
          customerContact: invoice.customerContact,
          currency: invoice.currency,
          totalMinor: invoice.totalMinor,
          status: dto.status,
          issuedAt: invoice.issuedAt.toISOString()
        },
        status: OutboxStatus.PENDING,
        attempts: 0,
        availableAt: new Date(),
        lockUntil: null,
        publishedAt: null,
        lastError: null
      });

      await this.audit.record(manager, {
        merchantId: invoice.merchantId,
        actorSubject: actor.subject ?? actor.actorMerchantId,
        action: "invoice.status_changed",
        resourceType: "invoice",
        resourceId: invoice.id,
        requestId,
        details: { from: invoice.status, to: dto.status, expectedVersion: dto.expectedVersion }
      });

      invoice.status = dto.status as InvoiceStatus;
      invoice.version += 1;
      return toResponse(invoice);
    });
  }

  private findIdempotency(
    manager: EntityManager,
    actorMerchantId: string,
    idempotencyKey: string
  ): Promise<IdempotencyRecordEntity | null> {
    return manager.findOne(IdempotencyRecordEntity, {
      where: { actorMerchantId, operation: "invoice.create", idempotencyKey }
    });
  }
}

function toResponse(invoice: InvoiceEntity): InvoiceResponse {
  return {
    id: invoice.id,
    storeId: invoice.storeId,
    status: invoice.status,
    currency: invoice.currency,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    issuedAt: invoice.issuedAt.toISOString(),
    version: invoice.version
  };
}

function isDuplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY");
}

function domainInput<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}
