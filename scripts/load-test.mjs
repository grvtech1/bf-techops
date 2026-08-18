import { performance } from "node:perf_hooks";

const apiUrl = process.env.API_URL ?? "http://127.0.0.1:8080";
const apiKey = process.env.PLATFORM_API_KEY ?? "local-platform-api-key-change-me";
const requests = positiveInteger(process.env.REQUESTS ?? "200", "REQUESTS");
const concurrency = positiveInteger(process.env.CONCURRENCY ?? "20", "CONCURRENCY");
const token = process.env.ACTOR_TOKEN ?? await developmentToken();
const latencies = [];
const statuses = new Map();
let cursor = 0;

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < requests) {
    const index = cursor++;
    const started = performance.now();
    const response = await fetch(`${apiUrl}/v1/invoices`, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${token}`,
        "x-platform-api-key": apiKey,
        "idempotency-key": `load:${Date.now()}:${String(index).padStart(8, "0")}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        storeId: "10000000-0000-4000-8000-000000000002",
        customerName: `Load User ${index}`,
        customerContact: `load-${index}@example.test`,
        currency: "INR",
        discountMinor: 0,
        taxRateBasisPoints: 1800,
        items: [{ description: "Load order", quantity: 1, unitPriceMinor: 10_000 }]
      })
    });
    latencies.push(performance.now() - started);
    statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    await response.arrayBuffer();
  }
}));

latencies.sort((left, right) => left - right);
const failures = [...statuses].filter(([status]) => status >= 400).reduce((total, [, count]) => total + count, 0);
process.stdout.write(`${JSON.stringify({
  requests,
  concurrency,
  statuses: Object.fromEntries(statuses),
  latencyMs: {
    p50: percentile(latencies, 0.50),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    max: Math.round(latencies.at(-1) ?? 0)
  },
  failures
}, null, 2)}\n`);
if (failures) process.exitCode = 1;

async function developmentToken() {
  const response = await fetch(`${apiUrl}/v1/auth/dev-token`, {
    method: "POST",
    headers: { "x-platform-api-key": apiKey }
  });
  if (!response.ok) throw new Error(`Could not obtain development token: HTTP ${response.status}`);
  return (await response.json()).token;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function percentile(values, quantile) {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return Math.round((values[index] ?? 0) * 100) / 100;
}

