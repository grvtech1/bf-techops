import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const invoiceTransitions = Object.freeze({
  DRAFT: new Set(["ISSUED", "CANCELLED"]),
  ISSUED: new Set(["PARTIALLY_PAID", "PAID", "CANCELLED"]),
  PARTIALLY_PAID: new Set(["PAID"]),
  PAID: new Set(["PARTIALLY_REFUNDED", "REFUNDED"]),
  PARTIALLY_REFUNDED: new Set(["REFUNDED"]),
  REFUNDED: new Set(),
  CANCELLED: new Set()
});

function requireInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${field} must be a safe integer greater than or equal to ${minimum}`);
  }
}

export function calculateInvoice({ items, discountMinor = 0, taxRateBasisPoints = 0 }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError("items must contain at least one line item");
  }

  requireInteger(discountMinor, "discountMinor");
  requireInteger(taxRateBasisPoints, "taxRateBasisPoints");
  if (taxRateBasisPoints > 10_000) {
    throw new RangeError("taxRateBasisPoints cannot exceed 10000");
  }

  const normalizedItems = items.map((item, index) => {
    const description = String(item.description ?? "").trim();
    if (!description) {
      throw new TypeError(`items[${index}].description is required`);
    }
    requireInteger(item.quantity, `items[${index}].quantity`, 1);
    requireInteger(item.unitPriceMinor, `items[${index}].unitPriceMinor`);

    const lineTotalMinor = item.quantity * item.unitPriceMinor;
    requireInteger(lineTotalMinor, `items[${index}].lineTotalMinor`);
    return { description, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, lineTotalMinor };
  });

  const subtotalMinor = normalizedItems.reduce((total, item) => total + item.lineTotalMinor, 0);
  requireInteger(subtotalMinor, "subtotalMinor");
  if (discountMinor > subtotalMinor) {
    throw new RangeError("discountMinor cannot exceed subtotalMinor");
  }

  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.round((taxableMinor * taxRateBasisPoints) / 10_000);
  const totalMinor = taxableMinor + taxMinor;

  return {
    items: normalizedItems,
    subtotalMinor,
    discountMinor,
    taxableMinor,
    taxRateBasisPoints,
    taxMinor,
    totalMinor
  };
}

export function assertStoreAccess({ actorMerchantId, store, merchantHierarchy }) {
  if (!actorMerchantId || !store?.merchantId) {
    throw new TypeError("actorMerchantId and store.merchantId are required");
  }

  const allowedMerchantIds = new Set([actorMerchantId, ...(merchantHierarchy[actorMerchantId] ?? [])]);
  if (!allowedMerchantIds.has(store.merchantId)) {
    const error = new Error("Actor is not authorized for the requested store");
    error.code = "STORE_ACCESS_DENIED";
    throw error;
  }
  return true;
}

export function assertInvoiceTransition(currentStatus, nextStatus) {
  const allowed = invoiceTransitions[currentStatus];
  if (!allowed || !allowed.has(nextStatus)) {
    const error = new Error(`Invoice cannot transition from ${currentStatus} to ${nextStatus}`);
    error.code = "INVALID_INVOICE_TRANSITION";
    throw error;
  }
  return true;
}

export function normalizeIdempotencyKey(value) {
  const key = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    throw new TypeError("Idempotency-Key must be 16-128 URL-safe characters");
  }
  return key;
}

export function requestFingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createActorToken(payload, secret) {
  validateTokenSecret(secret);
  validateActorPayload(payload, false);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyActorToken(token, secret, nowEpochSeconds = Math.floor(Date.now() / 1000)) {
  validateTokenSecret(secret);
  const [body, suppliedSignature, extra] = String(token ?? "").split(".");
  if (!body || !suppliedSignature || extra) {
    throw tokenError("Malformed actor token");
  }

  const expectedSignature = createHmac("sha256", secret).update(body).digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw tokenError("Invalid actor token signature");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw tokenError("Invalid actor token payload");
  }

  validateActorPayload(payload, true, nowEpochSeconds);
  return payload;
}

export function assertActorTokenPayload(payload, nowEpochSeconds = Math.floor(Date.now() / 1000)) {
  validateActorPayload(payload, true, nowEpochSeconds);
  return true;
}

export function constantTimeEqual(left, right) {
  const leftDigest = createHash("sha256").update(String(left ?? "")).digest();
  const rightDigest = createHash("sha256").update(String(right ?? "")).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function createWebhookSignature(rawBody, secret, timestamp) {
  validateTokenSecret(secret);
  const parsedTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(parsedTimestamp) || parsedTimestamp < 1) {
    throw new TypeError("Webhook timestamp must be a positive epoch second");
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  return createHmac("sha256", secret).update(`${parsedTimestamp}.`).update(body).digest("hex");
}

export function verifyWebhookSignature({
  rawBody,
  secret,
  timestamp,
  signature,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
}) {
  const parsedTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(parsedTimestamp) || parsedTimestamp < 1) {
    throw webhookError("Invalid webhook timestamp");
  }
  requireInteger(toleranceSeconds, "toleranceSeconds", 1);
  if (Math.abs(nowEpochSeconds - parsedTimestamp) > toleranceSeconds) {
    throw webhookError("Webhook timestamp is outside the replay window");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(signature ?? ""))) {
    throw webhookError("Invalid webhook signature format");
  }
  const expected = createWebhookSignature(rawBody, secret, parsedTimestamp);
  if (!constantTimeEqual(expected.toLowerCase(), String(signature).toLowerCase())) {
    throw webhookError("Invalid webhook signature");
  }
  return true;
}

function validateTokenSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("Actor token secret must contain at least 32 characters");
  }
}

function validateActorPayload(payload, requireFutureExpiry, nowEpochSeconds = 0) {
  if (!payload || typeof payload !== "object") throw tokenError("Actor token payload must be an object");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.actorMerchantId ?? "")) {
    throw tokenError("Actor token merchant ID must be a UUID");
  }
  if (!Array.isArray(payload.roles) || payload.roles.length < 1 || payload.roles.length > 32 ||
      !payload.roles.every((role) => typeof role === "string" && /^[a-z0-9:*._-]{1,80}$/i.test(role))) {
    throw tokenError("Actor token roles are invalid");
  }
  if (!Number.isSafeInteger(payload.exp) || payload.exp < 1) {
    throw tokenError("Actor token expiry is invalid");
  }
  if (requireFutureExpiry && payload.exp <= nowEpochSeconds) throw tokenError("Actor token has expired");
  if (payload.subject !== undefined && (typeof payload.subject !== "string" || payload.subject.length < 1 || payload.subject.length > 120)) {
    throw tokenError("Actor token subject is invalid");
  }
}

function tokenError(message) {
  const error = new Error(message);
  error.code = "INVALID_ACTOR_TOKEN";
  return error;
}

function webhookError(message) {
  const error = new Error(message);
  error.code = "INVALID_WEBHOOK_SIGNATURE";
  return error;
}
