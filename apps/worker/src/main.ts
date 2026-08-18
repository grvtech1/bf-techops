import "reflect-metadata";
import {
  DeliveryAttemptEntity,
  DeliveryStatus,
  databaseOptions
} from "@merchant-platform/persistence";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { DataSource } from "typeorm";
import { loadWorkerConfig } from "./config.js";
import { OutboxRelay } from "./outbox-relay.js";
import { createProvider, type InvoiceIssuedEvent } from "./provider.js";
import { WorkerTelemetry } from "./telemetry.js";

const queueName = "invoice-notifications";
const dlqName = "invoice-notifications-dlq";

async function main(): Promise<void> {
  const config = loadWorkerConfig(process.env);
  const dataSource = await new DataSource(databaseOptions(process.env)).initialize();
  const connection = new Redis({
    host: config.redisHost,
    port: config.redisPort,
    password: config.redisPassword,
    tls: config.redisTls ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: true
  });
  const queue = new Queue<InvoiceIssuedEvent>(queueName, { connection });
  const dlq = new Queue<InvoiceIssuedEvent>(dlqName, { connection });
  const provider = createProvider(config);
  const telemetry = new WorkerTelemetry(config.releaseVersion);
  telemetry.listen(config.metricsPort);

  const worker = new Worker<InvoiceIssuedEvent>(queueName, async (job: Job<InvoiceIssuedEvent>) => {
    const started = process.hrtime.bigint();
    const attemptNumber = job.attemptsMade + 1;
    try {
      const alreadyDelivered = await dataSource.getRepository(DeliveryAttemptEntity).findOne({
        where: { eventId: job.data.eventId, status: DeliveryStatus.SUCCEEDED }
      });
      if (alreadyDelivered) {
        telemetry.deliveries.inc({ outcome: "deduplicated" });
        return;
      }
      const result = await provider.send(job.data);
      await dataSource.getRepository(DeliveryAttemptEntity).upsert({
        eventId: job.data.eventId,
        attemptNumber,
        status: DeliveryStatus.SUCCEEDED,
        providerReference: result.providerReference,
        errorCode: null,
        errorMessage: null
      }, ["eventId", "attemptNumber"]);
      telemetry.deliveries.inc({ outcome: "succeeded" });
    } catch (error) {
      const finalAttempt = attemptNumber >= Number(job.opts.attempts ?? 1);
      await dataSource.getRepository(DeliveryAttemptEntity).upsert({
        eventId: job.data.eventId,
        attemptNumber,
        status: finalAttempt ? DeliveryStatus.DEAD_LETTERED : DeliveryStatus.RETRYING,
        providerReference: null,
        errorCode: code(error),
        errorMessage: message(error).slice(0, 1000)
      }, ["eventId", "attemptNumber"]);
      telemetry.deliveries.inc({ outcome: finalAttempt ? "dead_lettered" : "retrying" });
      throw error;
    } finally {
      telemetry.deliveryDuration.observe(Number(process.hrtime.bigint() - started) / 1_000_000_000);
    }
  }, { connection, concurrency: config.concurrency });

  worker.on("failed", (job) => {
    if (job && job.attemptsMade >= Number(job.opts.attempts ?? 1)) {
      void dlq.add("dead-letter", job.data, {
        jobId: job.data.eventId,
        removeOnComplete: false,
        removeOnFail: false
      });
    }
  });

  const relay = new OutboxRelay(dataSource, queue, config, telemetry);
  relay.start();
  void runRetention(dataSource, config).catch((error: unknown) => {
    log("error", "retention_failed", { error: message(error) });
  });
  const retentionTimer = setInterval(() => {
    void runRetention(dataSource, config).catch((error: unknown) => {
      log("error", "retention_failed", { error: message(error) });
    });
  }, 6 * 60 * 60 * 1000);
  retentionTimer.unref();
  await Promise.all([dataSource.query("SELECT 1"), connection.ping()]);
  telemetry.setReadinessCheck(async () => {
    await Promise.all([dataSource.query("SELECT 1"), connection.ping()]);
    return true;
  });
  telemetry.setReady(true);
  log("info", "worker_ready", { release: config.releaseVersion, concurrency: config.concurrency });

  const shutdown = async (signal: string): Promise<void> => {
    log("info", "worker_stopping", { signal });
    telemetry.setReady(false);
    clearInterval(retentionTimer);
    relay.stop();
    await worker.close();
    await queue.close();
    await dlq.close();
    await connection.quit();
    await dataSource.destroy();
    await telemetry.close();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

async function runRetention(dataSource: DataSource, config: ReturnType<typeof loadWorkerConfig>): Promise<void> {
  const idempotencyCutoff = new Date(Date.now() - config.idempotencyRetentionDays * 86_400_000);
  const outboxCutoff = new Date(Date.now() - config.outboxRetentionDays * 86_400_000);
  const webhookCutoff = new Date(Date.now() - config.webhookReceiptRetentionDays * 86_400_000);

  const outbox = await purgeInBatches(dataSource, `
    DELETE FROM outbox_events
    WHERE id IN (
      SELECT id FROM (
        SELECT event.id
        FROM outbox_events AS event
        WHERE event.status = 'PUBLISHED'
          AND event.published_at < ?
          AND EXISTS (
            SELECT 1 FROM delivery_attempts AS delivery
            WHERE delivery.event_id = event.id
              AND delivery.status IN ('SUCCEEDED', 'DEAD_LETTERED')
          )
        ORDER BY event.published_at
        LIMIT 1000
      ) AS purge
    )
  `, [outboxCutoff]);
  const delivery = await purgeInBatches(dataSource, `
    DELETE FROM delivery_attempts
    WHERE id IN (
      SELECT id FROM (
        SELECT delivery.id
        FROM delivery_attempts AS delivery
        LEFT JOIN outbox_events AS event ON event.id = delivery.event_id
        WHERE event.id IS NULL AND delivery.created_at < ?
        ORDER BY delivery.created_at
        LIMIT 1000
      ) AS purge
    )
  `, [outboxCutoff]);
  const idempotency = await purgeInBatches(dataSource, `
    DELETE FROM idempotency_records
    WHERE id IN (
      SELECT id FROM (
        SELECT id FROM idempotency_records WHERE created_at < ? ORDER BY created_at LIMIT 1000
      ) AS purge
    )
  `, [idempotencyCutoff]);
  const webhookReceipts = await purgeInBatches(dataSource, `
    DELETE FROM payment_webhook_receipts
    WHERE id IN (
      SELECT id FROM (
        SELECT id FROM payment_webhook_receipts WHERE received_at < ? ORDER BY received_at LIMIT 1000
      ) AS purge
    )
  `, [webhookCutoff]);
  log("info", "retention_completed", { outbox, delivery, idempotency, webhookReceipts });
}

async function purgeInBatches(dataSource: DataSource, sql: string, parameters: unknown[]): Promise<number> {
  let total = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await dataSource.query(sql, parameters) as { affectedRows?: number };
    const affected = Number(result.affectedRows ?? 0);
    total += affected;
    if (affected < 1000) break;
  }
  return total;
}

function log(level: string, message: string, fields: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields })}\n`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function code(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) return String(error.code);
  return "DELIVERY_FAILED";
}

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify({
    timestamp: new Date().toISOString(), level: "fatal", message: "worker_start_failed", error: message(error)
  })}\n`);
  process.exitCode = 1;
});
