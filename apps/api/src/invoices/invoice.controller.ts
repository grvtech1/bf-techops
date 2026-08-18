import { Body, Controller, DefaultValuePipe, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import { Actor, RequestIdentifier, RequireRoles } from "../common/http.js";
import { CreateInvoiceDto } from "./create-invoice.dto.js";
import { InvoiceService, type InvoiceResponse } from "./invoice.service.js";
import { UpdateInvoiceStatusDto } from "./update-invoice-status.dto.js";

@Controller("v1/invoices")
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  @RequireRoles("invoice:read")
  list(
    @Actor() actor: ActorTokenPayload,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number
  ): Promise<InvoiceResponse[]> {
    return this.invoices.list(actor, limit);
  }

  @Post()
  @HttpCode(201)
  @RequireRoles("invoice:write")
  create(
    @Actor() actor: ActorTokenPayload,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @RequestIdentifier() requestId: string,
    @Body() body: CreateInvoiceDto
  ): Promise<InvoiceResponse> {
    return this.invoices.create(actor, idempotencyKey, requestId, body);
  }

  @Get(":invoiceId")
  @RequireRoles("invoice:read")
  get(
    @Actor() actor: ActorTokenPayload,
    @Param("invoiceId", new ParseUUIDPipe()) invoiceId: string
  ): Promise<InvoiceResponse> {
    return this.invoices.get(actor, invoiceId);
  }

  @Patch(":invoiceId/status")
  @RequireRoles("invoice:write")
  transition(
    @Actor() actor: ActorTokenPayload,
    @Param("invoiceId", new ParseUUIDPipe()) invoiceId: string,
    @RequestIdentifier() requestId: string,
    @Body() body: UpdateInvoiceStatusDto
  ): Promise<InvoiceResponse> {
    return this.invoices.transition(actor, invoiceId, requestId, body);
  }
}
