export interface ApiConfig {
  nodeEnv: string;
  port: number;
  platformApiKey: string;
  actorTokenSecret?: string;
  actorJwksUrl?: string;
  actorIssuer?: string;
  actorAudience?: string;
  paymentProvider: string;
  paymentWebhookSecret: string;
  paymentWebhookToleranceSeconds: number;
  releaseVersion: string;
}

export const API_CONFIG = Symbol("API_CONFIG");

export function loadApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const platformApiKey = required(env, "PLATFORM_API_KEY");
  const nodeEnv = env.NODE_ENV ?? "development";
  if (platformApiKey.length < 16) {
    throw new Error("PLATFORM_API_KEY must contain at least 16 characters");
  }
  const actorTokenSecret = env.ACTOR_TOKEN_SECRET;
  const actorJwksUrl = env.ACTOR_JWKS_URL;
  const actorIssuer = env.ACTOR_ISSUER;
  const actorAudience = env.ACTOR_AUDIENCE;
  const paymentProvider = env.PAYMENT_PROVIDER ?? "sandboxpay";
  const paymentWebhookSecret = required(env, "PAYMENT_WEBHOOK_SECRET");
  if (!/^[a-z0-9-]{2,40}$/.test(paymentProvider)) {
    throw new Error("PAYMENT_PROVIDER must contain 2-40 lowercase letters, digits, or hyphens");
  }
  if (paymentWebhookSecret.length < 32) {
    throw new Error("PAYMENT_WEBHOOK_SECRET must contain at least 32 characters");
  }
  if (nodeEnv === "production") {
    if (!actorJwksUrl || !actorIssuer || !actorAudience) {
      throw new Error("ACTOR_JWKS_URL, ACTOR_ISSUER, and ACTOR_AUDIENCE are required in production");
    }
    new URL(actorJwksUrl);
  } else if (!actorTokenSecret || actorTokenSecret.length < 32) {
    throw new Error("ACTOR_TOKEN_SECRET must contain at least 32 characters outside production");
  }

  const port = Number(env.API_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be a valid TCP port");
  }
  return {
    nodeEnv,
    port,
    platformApiKey,
    actorTokenSecret,
    actorJwksUrl,
    actorIssuer,
    actorAudience,
    paymentProvider,
    paymentWebhookSecret,
    paymentWebhookToleranceSeconds: boundedInteger(
      env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS ?? "300",
      "PAYMENT_WEBHOOK_TOLERANCE_SECONDS",
      30,
      900
    ),
    releaseVersion: env.RELEASE_VERSION ?? "unknown"
  };
}

function boundedInteger(value: string, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}
