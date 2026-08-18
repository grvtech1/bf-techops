import { createHash } from "node:crypto";
import type { WorkerConfig } from "./config.js";

export interface InvoiceIssuedEvent {
  eventId: string;
  invoiceId: string;
  merchantId: string;
  storeId: string;
  customerName: string;
  customerContact: string;
  currency: string;
  totalMinor: number;
  status: "ISSUED" | "PARTIALLY_PAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED" | "CANCELLED";
  issuedAt: string;
}

export interface DeliveryResult {
  providerReference: string;
}

export interface NotificationProvider {
  send(event: InvoiceIssuedEvent): Promise<DeliveryResult>;
}

export function createProvider(config: WorkerConfig): NotificationProvider {
  return config.provider === "webhook"
    ? new WebhookNotificationProvider(config.providerUrl!, config.providerApiKey!)
    : new LogNotificationProvider();
}

class LogNotificationProvider implements NotificationProvider {
  async send(event: InvoiceIssuedEvent): Promise<DeliveryResult> {
    const contactHash = createHash("sha256").update(event.customerContact).digest("hex").slice(0, 12);
    process.stdout.write(`${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      message: "notification_simulated",
      eventId: event.eventId,
      invoiceId: event.invoiceId,
      contactHash
    })}\n`);
    return { providerReference: `log:${event.eventId}` };
  }
}

class WebhookNotificationProvider implements NotificationProvider {
  constructor(private readonly url: string, private readonly apiKey: string) {}

  async send(event: InvoiceIssuedEvent): Promise<DeliveryResult> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": event.eventId
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) {
      const error = new Error(`Notification provider returned HTTP ${response.status}`);
      Object.assign(error, { code: `PROVIDER_HTTP_${response.status}` });
      throw error;
    }
    return { providerReference: response.headers.get("x-provider-request-id") ?? event.eventId };
  }
}
