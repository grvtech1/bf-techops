import test from "node:test";
import assert from "node:assert/strict";
import {
  assertInvoiceTransition,
  assertStoreAccess,
  calculateInvoice,
  createActorToken,
  normalizeIdempotencyKey,
  createWebhookSignature,
  requestFingerprint,
  verifyWebhookSignature,
  verifyActorToken
} from "../src/index.js";

test("calculates invoice money in integer minor units", () => {
  const invoice = calculateInvoice({
    items: [
      { description: "Coffee", quantity: 2, unitPriceMinor: 12_500 },
      { description: "Delivery", quantity: 1, unitPriceMinor: 2_000 }
    ],
    discountMinor: 2_000,
    taxRateBasisPoints: 1_800
  });

  assert.deepEqual(
    {
      subtotalMinor: invoice.subtotalMinor,
      taxableMinor: invoice.taxableMinor,
      taxMinor: invoice.taxMinor,
      totalMinor: invoice.totalMinor
    },
    { subtotalMinor: 27_000, taxableMinor: 25_000, taxMinor: 4_500, totalMinor: 29_500 }
  );
});

test("rejects discounts above the invoice subtotal", () => {
  assert.throws(
    () => calculateInvoice({
      items: [{ description: "Item", quantity: 1, unitPriceMinor: 100 }],
      discountMinor: 101
    }),
    /cannot exceed subtotal/
  );
});

test("authorizes a root merchant for a child store", () => {
  assert.equal(assertStoreAccess({
    actorMerchantId: "00000000-0000-4000-8000-000000000001",
    store: { merchantId: "00000000-0000-4000-8000-000000000002" },
    merchantHierarchy: {
      "00000000-0000-4000-8000-000000000001": ["00000000-0000-4000-8000-000000000002"]
    }
  }), true);
});

test("denies cross-tenant store access", () => {
  assert.throws(
    () => assertStoreAccess({
      actorMerchantId: "merchant-a",
      store: { merchantId: "merchant-b" },
      merchantHierarchy: { "merchant-a": [] }
    }),
    (error) => error.code === "STORE_ACCESS_DENIED"
  );
});

test("enforces terminal invoice states", () => {
  assert.equal(assertInvoiceTransition("ISSUED", "PAID"), true);
  assert.equal(assertInvoiceTransition("ISSUED", "PARTIALLY_PAID"), true);
  assert.equal(assertInvoiceTransition("PAID", "PARTIALLY_REFUNDED"), true);
  assert.equal(assertInvoiceTransition("PARTIALLY_REFUNDED", "REFUNDED"), true);
  assert.throws(
    () => assertInvoiceTransition("PAID", "CANCELLED"),
    (error) => error.code === "INVALID_INVOICE_TRANSITION"
  );
  assert.throws(
    () => assertInvoiceTransition("REFUNDED", "PAID"),
    (error) => error.code === "INVALID_INVOICE_TRANSITION"
  );
});

test("normalizes strong idempotency keys and creates stable request fingerprints", () => {
  assert.equal(normalizeIdempotencyKey("invoice:client:0001"), "invoice:client:0001");
  assert.equal(requestFingerprint({ b: 2, a: 1 }), requestFingerprint({ a: 1, b: 2 }));
  assert.throws(() => normalizeIdempotencyKey("short"), /16-128/);
});

test("signs and verifies actor identity without trusting request merchant fields", () => {
  const secret = "test-secret-that-is-at-least-32-characters";
  const token = createActorToken({
    actorMerchantId: "00000000-0000-4000-8000-000000000001",
    roles: ["invoice:write"],
    exp: 2_000
  }, secret);

  const payload = verifyActorToken(token, secret, 1_000);
  assert.equal(payload.actorMerchantId, "00000000-0000-4000-8000-000000000001");
  assert.throws(() => verifyActorToken(`${token}x`, secret, 1_000), /signature/);
  assert.throws(() => verifyActorToken(token, secret, 2_000), /expired/);
});

test("verifies payment callbacks and rejects tampering or replay", () => {
  const secret = "payment-webhook-secret-at-least-32-characters";
  const rawBody = '{"providerEventId":"evt-1001","amountMinor":11800}';
  const timestamp = 1_800_000_000;
  const signature = createWebhookSignature(rawBody, secret, timestamp);

  assert.equal(verifyWebhookSignature({
    rawBody,
    secret,
    timestamp,
    signature,
    nowEpochSeconds: timestamp + 30
  }), true);
  assert.throws(() => verifyWebhookSignature({
    rawBody: `${rawBody} `,
    secret,
    timestamp,
    signature,
    nowEpochSeconds: timestamp + 30
  }), /Invalid webhook signature/);
  assert.throws(() => verifyWebhookSignature({
    rawBody,
    secret,
    timestamp,
    signature,
    nowEpochSeconds: timestamp + 301
  }), /replay window/);
});
