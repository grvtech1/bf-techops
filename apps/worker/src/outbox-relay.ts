import { DeliveryAttemptEntity, DeliveryStatus, OutboxEventEntity, OutboxStatus } from "@merchant-platform/persistence";
import type { Queue } from "bullmq";
import { LessThan, type DataSource } from "typeorm";
import type { InvoiceIssuedEvent } from "./provider.js";
import type { WorkerConfig } from "./config.js";
import type { WorkerTelemetry } from "./telemetry.js";

export class OutboxRelay {
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: Queue<InvoiceIssuedEvent>,
    private readonly config: WorkerConfig,
    private readonly telemetry: WorkerTelemetry
  ) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const events = await this.claim(25);
      this.telemetry.outboxClaimed.inc(events.length);
      for (const event of events) {
        try {
          await this.queue.add("deliver-invoice-notification", event.payload as unknown as InvoiceIssuedEvent, {
            jobId: event.id,
            attempts: this.config.maxAttempts,
            backoff: { type: "exponential", delay: this.config.baseDelayMs },
            removeOnComplete: { age: 86_400, count: 10_000 },
            removeOnFail: false
          });
          await this.dataSource.getRepository(OutboxEventEntity).update(
            { id: event.id, status: OutboxStatus.PROCESSING },
            { status: OutboxStatus.PUBLISHED, publishedAt: new Date(), lockUntil: null, lastError: null }
          );
        } catch (error) {
          await this.dataSource.getRepository(OutboxEventEntity).update(
            { id: event.id, status: OutboxStatus.PROCESSING },
            {
              status: OutboxStatus.PENDING,
              availableAt: new Date(Date.now() + this.config.baseDelayMs),
              lockUntil: null,
              lastError: message(error).slice(0, 1000)
            }
          );
        }
      }
      await this.reconcilePublished(100);
      await this.updateMetrics();
    } finally {
      this.polling = false;
    }
  }

  private claim(limit: number): Promise<OutboxEventEntity[]> {
    return this.dataSource.transaction("READ COMMITTED", async (manager) => {
      const now = new Date();
      const events = await manager.createQueryBuilder(OutboxEventEntity, "event")
        .setLock("pessimistic_write")
        .setOnLocked("skip_locked")
        .where("event.available_at <= :now", { now })
        .andWhere("(event.status = :pending OR (event.status = :processing AND event.lock_until < :now))", {
          pending: OutboxStatus.PENDING,
          processing: OutboxStatus.PROCESSING,
          now
        })
        .orderBy("event.created_at", "ASC")
        .limit(limit)
        .getMany();

      if (events.length) {
        const ids = events.map((event) => event.id);
        await manager.createQueryBuilder()
          .update(OutboxEventEntity)
          .set({
            status: OutboxStatus.PROCESSING,
            lockUntil: new Date(Date.now() + 30_000),
            attempts: () => "attempts + 1"
          })
          .whereInIds(ids)
          .execute();
      }
      return events;
    });
  }

  private async updateMetrics(): Promise<void> {
    const repository = this.dataSource.getRepository(OutboxEventEntity);
    const oldest = await repository.findOne({
      where: { status: OutboxStatus.PENDING, createdAt: LessThan(new Date()) },
      order: { createdAt: "ASC" }
    });
    this.telemetry.outboxOldestAge.set(oldest ? (Date.now() - oldest.createdAt.getTime()) / 1000 : 0);
    const counts = await this.queue.getJobCounts("waiting", "failed");
    this.telemetry.queueWaiting.set(counts.waiting ?? 0);
    this.telemetry.queueFailed.set(counts.failed ?? 0);
  }

  private async reconcilePublished(limit: number): Promise<void> {
    const events = await this.dataSource.createQueryBuilder(OutboxEventEntity, "event")
      .where("event.status = :published", { published: OutboxStatus.PUBLISHED })
      .andWhere((query) => {
        const terminal = query.subQuery()
          .select("1")
          .from(DeliveryAttemptEntity, "delivery")
          .where("delivery.event_id = event.id")
          .andWhere("delivery.status IN (:...terminalStatuses)")
          .getQuery();
        return `NOT EXISTS ${terminal}`;
      })
      .setParameter("terminalStatuses", [DeliveryStatus.SUCCEEDED, DeliveryStatus.DEAD_LETTERED])
      .andWhere("event.published_at < :cutoff", { cutoff: new Date(Date.now() - 30_000) })
      .orderBy("event.published_at", "ASC")
      .limit(limit)
      .getMany();

    for (const event of events) {
      await this.queue.add("deliver-invoice-notification", event.payload as unknown as InvoiceIssuedEvent, {
        jobId: event.id,
        attempts: this.config.maxAttempts,
        backoff: { type: "exponential", delay: this.config.baseDelayMs },
        removeOnComplete: { age: 86_400, count: 10_000 },
        removeOnFail: false
      });
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
