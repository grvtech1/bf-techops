import { createServer, type Server } from "node:http";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export class WorkerTelemetry {
  readonly registry = new Registry();
  readonly deliveries = new Counter({
    name: "merchant_platform_notification_deliveries_total",
    help: "Notification delivery attempts by outcome",
    labelNames: ["outcome"],
    registers: [this.registry]
  });
  readonly deliveryDuration = new Histogram({
    name: "merchant_platform_notification_delivery_duration_seconds",
    help: "Notification provider latency",
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry]
  });
  readonly outboxClaimed = new Counter({
    name: "merchant_platform_outbox_claimed_total",
    help: "Outbox rows claimed for queue publication",
    registers: [this.registry]
  });
  readonly outboxOldestAge = new Gauge({
    name: "merchant_platform_outbox_oldest_pending_age_seconds",
    help: "Age of the oldest unpublished outbox event",
    registers: [this.registry]
  });
  readonly queueWaiting = new Gauge({
    name: "merchant_platform_notification_queue_waiting",
    help: "Notification jobs waiting in BullMQ",
    registers: [this.registry]
  });
  readonly queueFailed = new Gauge({
    name: "merchant_platform_notification_queue_failed",
    help: "Notification jobs in failed state",
    registers: [this.registry]
  });
  readonly release = new Gauge({
    name: "merchant_platform_worker_release_info",
    help: "Release identity for the running worker",
    labelNames: ["version"],
    registers: [this.registry]
  });

  private server?: Server;
  private ready = false;
  private readinessCheck: () => Promise<boolean> = async () => false;

  constructor(releaseVersion: string) {
    collectDefaultMetrics({ register: this.registry, prefix: "merchant_platform_worker_" });
    this.release.set({ version: releaseVersion }, 1);
  }

  setReady(value: boolean): void {
    this.ready = value;
  }

  setReadinessCheck(check: () => Promise<boolean>): void {
    this.readinessCheck = check;
  }

  listen(port: number): void {
    this.server = createServer(async (request, response) => {
      if (request.url === "/metrics") {
        response.writeHead(200, { "content-type": this.registry.contentType });
        response.end(await this.registry.metrics());
        return;
      }
      if (request.url === "/health/live") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "alive" }));
        return;
      }
      if (request.url === "/health/ready") {
        const dependenciesReady = this.ready && await this.readinessCheck().catch(() => false);
        response.writeHead(dependenciesReady ? 200 : 503, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: dependenciesReady ? "ready" : "not_ready" }));
        return;
      }
      response.writeHead(404).end();
    }).listen(port, "0.0.0.0");
  }

  async close(): Promise<void> {
    this.registry.clear();
    await new Promise<void>((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }
}
