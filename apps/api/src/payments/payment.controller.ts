import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
  RawBodyRequest,
  Req
} from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import type { PaymentEntity } from "@merchant-platform/persistence";
import type { Request } from "express";
import { Actor, Public, RequestIdentifier, RequireRoles } from "../common/http.js";
import { API_CONFIG, type ApiConfig } from "../config.js";
import { PaymentWebhookDto } from "./payment-webhook.dto.js";
import { PaymentService, type PaymentWebhookResponse } from "./payment.service.js";

@Controller("v1/payments")
export class PaymentController {
  constructor(
    private readonly payments: PaymentService,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  @Get()
  @RequireRoles("payment:read")
  list(
    @Actor() actor: ActorTokenPayload,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit: number
  ): Promise<PaymentEntity[]> {
    return this.payments.list(actor, limit);
  }

  @Public()
  @Post("webhooks/:provider")
  @HttpCode(200)
  webhook(
    @Param("provider") provider: string,
    @Headers("x-payment-timestamp") timestamp: string,
    @Headers("x-payment-signature") signature: string,
    @RequestIdentifier() requestId: string,
    @Req() request: RawBodyRequest<Request>,
    @Body() body: PaymentWebhookDto
  ): Promise<PaymentWebhookResponse> {
    if (!request.rawBody) throw new Error("Raw webhook body was not captured");
    return this.payments.handleWebhook(
      this.config,
      provider,
      timestamp,
      signature,
      request.rawBody,
      body,
      requestId
    );
  }
}
