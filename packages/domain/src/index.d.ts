export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface CalculatedInvoiceLine extends InvoiceLineInput {
  lineTotalMinor: number;
}

export interface CalculatedInvoice {
  items: CalculatedInvoiceLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxRateBasisPoints: number;
  taxMinor: number;
  totalMinor: number;
}

export interface ActorTokenPayload {
  actorMerchantId: string;
  roles: string[];
  exp: number;
  subject?: string;
}

export function calculateInvoice(input: {
  items: InvoiceLineInput[];
  discountMinor?: number;
  taxRateBasisPoints?: number;
}): CalculatedInvoice;
export function assertStoreAccess(input: {
  actorMerchantId: string;
  store: { merchantId: string };
  merchantHierarchy: Record<string, string[]>;
}): true;
export function assertInvoiceTransition(currentStatus: string, nextStatus: string): true;
export function normalizeIdempotencyKey(value: unknown): string;
export function requestFingerprint(value: unknown): string;
export function stableJson(value: unknown): string;
export function createActorToken(payload: ActorTokenPayload, secret: string): string;
export function verifyActorToken(token: string, secret: string, nowEpochSeconds?: number): ActorTokenPayload;
export function assertActorTokenPayload(payload: unknown, nowEpochSeconds?: number): true;
export function constantTimeEqual(left: unknown, right: unknown): boolean;
export function createWebhookSignature(rawBody: Buffer | string, secret: string, timestamp: number | string): string;
export function verifyWebhookSignature(input: {
  rawBody: Buffer | string;
  secret: string;
  timestamp: number | string;
  signature: string;
  nowEpochSeconds?: number;
  toleranceSeconds?: number;
}): true;
