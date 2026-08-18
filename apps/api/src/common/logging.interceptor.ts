import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor
} from "@nestjs/common";
import type { ActorTokenPayload } from "@merchant-platform/domain";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { TelemetryService } from "../telemetry/telemetry.service.js";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly telemetry: TelemetryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & {
      requestId?: string;
      actor?: ActorTokenPayload;
    }>();
    const response = context.switchToHttp().getResponse<Response>();
    const started = process.hrtime.bigint();

    response.once("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      const route = request.route?.path ? `${request.baseUrl}${request.route.path}` : "unmatched";
      const internalSuccess = response.statusCode < 400 && [
        "/health/live",
        "/health/ready",
        "/metrics"
      ].includes(request.path);
      if (internalSuccess) return;
      this.telemetry.observeHttp(request.method, route, response.statusCode, durationSeconds);
      process.stdout.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: response.statusCode >= 500 ? "error" : "info",
        message: "request_completed",
        requestId: request.requestId,
        actorMerchantId: request.actor?.actorMerchantId,
        method: request.method,
        route,
        statusCode: response.statusCode,
        durationMs: Math.round(durationSeconds * 100_000) / 100
      })}\n`);
    });
    return next.handle();
  }
}
