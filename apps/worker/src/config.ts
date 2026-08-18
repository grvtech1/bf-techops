export interface WorkerConfig {
  redisHost: string;
  redisPort: number;
  redisTls: boolean;
  redisPassword?: string;
  pollIntervalMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  concurrency: number;
  metricsPort: number;
  provider: "log" | "webhook";
  providerUrl?: string;
  providerApiKey?: string;
  releaseVersion: string;
  idempotencyRetentionDays: number;
  outboxRetentionDays: number;
  webhookReceiptRetentionDays: number;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const provider = env.NOTIFICATION_PROVIDER ?? "log";
  if (provider !== "log" && provider !== "webhook") {
    throw new Error("NOTIFICATION_PROVIDER must be log or webhook");
  }
  if ((env.NODE_ENV ?? "development") === "production" && provider === "log") {
    throw new Error("The log notification provider is forbidden in production");
  }
  if (provider === "webhook" && (!env.NOTIFICATION_PROVIDER_URL || !env.NOTIFICATION_PROVIDER_API_KEY)) {
    throw new Error("Webhook provider URL and API key are required");
  }

  return {
    redisHost: required(env, "REDIS_HOST"),
    redisPort: integer(env.REDIS_PORT ?? "6379", "REDIS_PORT", 1, 65_535),
    redisTls: env.REDIS_TLS === "true",
    redisPassword: env.REDIS_PASSWORD,
    pollIntervalMs: integer(env.OUTBOX_POLL_INTERVAL_MS ?? "1000", "OUTBOX_POLL_INTERVAL_MS", 100, 60_000),
    maxAttempts: integer(env.NOTIFICATION_MAX_ATTEMPTS ?? "5", "NOTIFICATION_MAX_ATTEMPTS", 1, 20),
    baseDelayMs: integer(env.NOTIFICATION_BASE_DELAY_MS ?? "1000", "NOTIFICATION_BASE_DELAY_MS", 100, 60_000),
    concurrency: integer(env.WORKER_CONCURRENCY ?? "8", "WORKER_CONCURRENCY", 1, 100),
    metricsPort: integer(env.WORKER_METRICS_PORT ?? "9091", "WORKER_METRICS_PORT", 1, 65_535),
    provider,
    providerUrl: env.NOTIFICATION_PROVIDER_URL,
    providerApiKey: env.NOTIFICATION_PROVIDER_API_KEY,
    releaseVersion: env.RELEASE_VERSION ?? "unknown",
    idempotencyRetentionDays: integer(env.IDEMPOTENCY_RETENTION_DAYS ?? "7", "IDEMPOTENCY_RETENTION_DAYS", 1, 90),
    outboxRetentionDays: integer(env.OUTBOX_RETENTION_DAYS ?? "30", "OUTBOX_RETENTION_DAYS", 7, 365),
    webhookReceiptRetentionDays: integer(
      env.WEBHOOK_RECEIPT_RETENTION_DAYS ?? "400",
      "WEBHOOK_RECEIPT_RETENTION_DAYS",
      90,
      2_555
    )
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function integer(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}
