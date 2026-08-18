import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { API_CONFIG, type ApiConfig } from "../config.js";

@Injectable()
export class TelemetryService implements OnModuleDestroy {
  readonly registry = new Registry();
  readonly httpRequests = new Counter({
    name: "merchant_platform_http_requests_total",
    help: "HTTP requests completed by the API",
    labelNames: ["method", "route", "status"],
    registers: [this.registry]
  });
  readonly httpDuration = new Histogram({
    name: "merchant_platform_http_request_duration_seconds",
    help: "API request latency",
    labelNames: ["method", "route"],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry]
  });
  readonly invoices = new Counter({
    name: "merchant_platform_invoices_total",
    help: "Invoice create outcomes",
    labelNames: ["outcome"],
    registers: [this.registry]
  });
  readonly paymentWebhooks = new Counter({
    name: "merchant_platform_payment_webhooks_total",
    help: "Payment webhook processing outcomes",
    labelNames: ["outcome", "event_type"],
    registers: [this.registry]
  });
  readonly release = new Gauge({
    name: "merchant_platform_release_info",
    help: "Release identity for the running API",
    labelNames: ["version"],
    registers: [this.registry]
  });

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    collectDefaultMetrics({ register: this.registry, prefix: "merchant_platform_api_" });
    this.release.set({ version: config.releaseVersion }, 1);
  }

  observeHttp(method: string, route: string, statusCode: number, durationSeconds: number): void {
    this.httpRequests.inc({ method, route, status: String(statusCode) });
    this.httpDuration.observe({ method, route }, durationSeconds);
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}
