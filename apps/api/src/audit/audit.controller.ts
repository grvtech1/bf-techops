import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import type { AuditEventEntity } from "@merchant-platform/persistence";
import { Actor, RequireRoles } from "../common/http.js";
import { AuditService } from "./audit.service.js";

@Controller("v1/audit-events")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireRoles("audit:read")
  list(
    @Actor() actor: ActorTokenPayload,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number
  ): Promise<AuditEventEntity[]> {
    return this.audit.list(actor, limit);
  }
}
