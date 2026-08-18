import { Injectable } from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import { AuditEventEntity } from "@merchant-platform/persistence";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource, In, type EntityManager } from "typeorm";
import { MerchantScopeService } from "../invoices/merchant-scope.service.js";

export interface AuditRecordInput {
  merchantId: string;
  actorSubject: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId?: string;
  details?: object;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly merchantScope: MerchantScopeService
  ) {}

  async record(manager: EntityManager, input: AuditRecordInput): Promise<void> {
    await manager.insert(AuditEventEntity, {
      id: randomUUID(),
      merchantId: input.merchantId,
      actorSubject: input.actorSubject,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      requestId: input.requestId ?? null,
      details: input.details ?? {}
    });
  }

  async list(actor: ActorTokenPayload, limit: number): Promise<AuditEventEntity[]> {
    const merchantIds = await this.merchantScope.authorizedMerchantIds(
      this.dataSource.manager,
      actor.actorMerchantId
    );
    return this.dataSource.getRepository(AuditEventEntity).find({
      where: { merchantId: In(merchantIds) },
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(limit, 1), 100)
    });
  }
}
