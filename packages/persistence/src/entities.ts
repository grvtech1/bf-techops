import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn
} from "typeorm";

export enum InvoiceStatus {
  DRAFT = "DRAFT",
  ISSUED = "ISSUED",
  PARTIALLY_PAID = "PARTIALLY_PAID",
  PAID = "PAID",
  PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
  REFUNDED = "REFUNDED",
  CANCELLED = "CANCELLED"
}

export enum OutboxStatus {
  PENDING = "PENDING",
  PROCESSING = "PROCESSING",
  PUBLISHED = "PUBLISHED"
}

export enum DeliveryStatus {
  SUCCEEDED = "SUCCEEDED",
  RETRYING = "RETRYING",
  DEAD_LETTERED = "DEAD_LETTERED"
}

export enum PaymentStatus {
  CAPTURED = "CAPTURED",
  PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED",
  REFUNDED = "REFUNDED"
}

@Entity("merchants")
export class MerchantEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "parent_merchant_id", type: "char", length: 36, nullable: true })
  @Index()
  parentMerchantId!: string | null;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;
}

@Entity("stores")
@Index(["merchantId", "code"], { unique: true })
export class StoreEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "merchant_id", type: "char", length: 36 })
  @Index()
  merchantId!: string;

  @ManyToOne(() => MerchantEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "merchant_id" })
  merchant!: MerchantEntity;

  @Column({ type: "varchar", length: 40 })
  code!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ name: "timezone", type: "varchar", length: 64, default: "Asia/Kolkata" })
  timezone!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;
}

@Entity("invoices")
@Index(["merchantId", "createdAt"])
@Index(["storeId", "status"])
export class InvoiceEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "merchant_id", type: "char", length: 36 })
  merchantId!: string;

  @Column({ name: "store_id", type: "char", length: 36 })
  storeId!: string;

  @ManyToOne(() => StoreEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "store_id" })
  store!: StoreEntity;

  @Column({ name: "created_by", type: "varchar", length: 120 })
  createdBy!: string;

  @Column({ name: "customer_name", type: "varchar", length: 160 })
  customerName!: string;

  @Column({ name: "customer_contact", type: "varchar", length: 254 })
  customerContact!: string;

  @Column({ type: "char", length: 3, default: "INR" })
  currency!: string;

  @Column({ name: "subtotal_minor", type: "int", unsigned: true })
  subtotalMinor!: number;

  @Column({ name: "discount_minor", type: "int", unsigned: true, default: 0 })
  discountMinor!: number;

  @Column({ name: "tax_rate_basis_points", type: "smallint", unsigned: true, default: 0 })
  taxRateBasisPoints!: number;

  @Column({ name: "tax_minor", type: "int", unsigned: true, default: 0 })
  taxMinor!: number;

  @Column({ name: "total_minor", type: "int", unsigned: true })
  totalMinor!: number;

  @Column({ type: "enum", enum: InvoiceStatus, default: InvoiceStatus.ISSUED })
  status!: InvoiceStatus;

  @Column({ name: "issued_at", type: "datetime", precision: 3 })
  issuedAt!: Date;

  @OneToMany(() => InvoiceLineEntity, (line) => line.invoice, { cascade: false })
  lines!: InvoiceLineEntity[];

  @VersionColumn({ type: "int", unsigned: true })
  version!: number;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;
}

@Entity("invoice_lines")
@Index(["invoiceId", "position"], { unique: true })
export class InvoiceLineEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "invoice_id", type: "char", length: 36 })
  invoiceId!: string;

  @ManyToOne(() => InvoiceEntity, (invoice) => invoice.lines, { onDelete: "CASCADE" })
  @JoinColumn({ name: "invoice_id" })
  invoice!: InvoiceEntity;

  @Column({ type: "smallint", unsigned: true })
  position!: number;

  @Column({ type: "varchar", length: 240 })
  description!: string;

  @Column({ type: "smallint", unsigned: true })
  quantity!: number;

  @Column({ name: "unit_price_minor", type: "int", unsigned: true })
  unitPriceMinor!: number;

  @Column({ name: "line_total_minor", type: "int", unsigned: true })
  lineTotalMinor!: number;
}

@Entity("idempotency_records")
@Index(["actorMerchantId", "operation", "idempotencyKey"], { unique: true })
export class IdempotencyRecordEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "actor_merchant_id", type: "char", length: 36 })
  actorMerchantId!: string;

  @Column({ type: "varchar", length: 80 })
  operation!: string;

  @Column({ name: "idempotency_key", type: "varchar", length: 128 })
  idempotencyKey!: string;

  @Column({ name: "request_hash", type: "char", length: 64 })
  requestHash!: string;

  @Column({ name: "response_status", type: "smallint", unsigned: true })
  responseStatus!: number;

  @Column({ name: "response_body", type: "json" })
  responseBody!: object;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;
}

@Entity("outbox_events")
@Index(["status", "availableAt", "createdAt"])
export class OutboxEventEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "aggregate_type", type: "varchar", length: 80 })
  aggregateType!: string;

  @Column({ name: "aggregate_id", type: "char", length: 36 })
  aggregateId!: string;

  @Column({ name: "merchant_id", type: "char", length: 36 })
  @Index()
  merchantId!: string;

  @Column({ name: "event_type", type: "varchar", length: 120 })
  eventType!: string;

  @Column({ type: "json" })
  payload!: Record<string, unknown>;

  @Column({ type: "enum", enum: OutboxStatus, default: OutboxStatus.PENDING })
  status!: OutboxStatus;

  @Column({ type: "smallint", unsigned: true, default: 0 })
  attempts!: number;

  @Column({ name: "available_at", type: "datetime", precision: 3 })
  availableAt!: Date;

  @Column({ name: "lock_until", type: "datetime", precision: 3, nullable: true })
  lockUntil!: Date | null;

  @Column({ name: "published_at", type: "datetime", precision: 3, nullable: true })
  publishedAt!: Date | null;

  @Column({ name: "last_error", type: "varchar", length: 1000, nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;
}

@Entity("delivery_attempts")
@Index(["eventId", "attemptNumber"], { unique: true })
export class DeliveryAttemptEntity {
  @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
  id!: string;

  @Column({ name: "event_id", type: "char", length: 36 })
  @Index()
  eventId!: string;

  @Column({ name: "attempt_number", type: "smallint", unsigned: true })
  attemptNumber!: number;

  @Column({ type: "enum", enum: DeliveryStatus })
  status!: DeliveryStatus;

  @Column({ name: "provider_reference", type: "varchar", length: 160, nullable: true })
  providerReference!: string | null;

  @Column({ name: "error_code", type: "varchar", length: 80, nullable: true })
  errorCode!: string | null;

  @Column({ name: "error_message", type: "varchar", length: 1000, nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;
}

@Entity("payments")
@Index(["provider", "providerPaymentId"], { unique: true })
@Index(["merchantId", "createdAt"])
@Index(["invoiceId", "status"])
export class PaymentEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "merchant_id", type: "char", length: 36 })
  merchantId!: string;

  @Column({ name: "invoice_id", type: "char", length: 36 })
  invoiceId!: string;

  @ManyToOne(() => InvoiceEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "invoice_id" })
  invoice!: InvoiceEntity;

  @Column({ type: "varchar", length: 40 })
  provider!: string;

  @Column({ name: "provider_payment_id", type: "varchar", length: 120 })
  providerPaymentId!: string;

  @Column({ name: "amount_minor", type: "int", unsigned: true })
  amountMinor!: number;

  @Column({ name: "refunded_minor", type: "int", unsigned: true, default: 0 })
  refundedMinor!: number;

  @Column({ type: "char", length: 3 })
  currency!: string;

  @Column({ type: "enum", enum: PaymentStatus, default: PaymentStatus.CAPTURED })
  status!: PaymentStatus;

  @Column({ name: "captured_at", type: "datetime", precision: 3 })
  capturedAt!: Date;

  @VersionColumn({ type: "int", unsigned: true })
  version!: number;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "datetime", precision: 3 })
  updatedAt!: Date;
}

@Entity("refunds")
@Index(["provider", "providerRefundId"], { unique: true })
export class RefundEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "merchant_id", type: "char", length: 36 })
  @Index()
  merchantId!: string;

  @Column({ name: "payment_id", type: "char", length: 36 })
  paymentId!: string;

  @ManyToOne(() => PaymentEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "payment_id" })
  payment!: PaymentEntity;

  @Column({ type: "varchar", length: 40 })
  provider!: string;

  @Column({ name: "provider_refund_id", type: "varchar", length: 120 })
  providerRefundId!: string;

  @Column({ name: "amount_minor", type: "int", unsigned: true })
  amountMinor!: number;

  @Column({ name: "refunded_at", type: "datetime", precision: 3 })
  refundedAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;
}

@Entity("payment_webhook_receipts")
@Index(["provider", "providerEventId"], { unique: true })
export class PaymentWebhookReceiptEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ type: "varchar", length: 40 })
  provider!: string;

  @Column({ name: "provider_event_id", type: "varchar", length: 120 })
  providerEventId!: string;

  @Column({ name: "event_type", type: "varchar", length: 80 })
  eventType!: string;

  @Column({ name: "payload_hash", type: "char", length: 64 })
  payloadHash!: string;

  @CreateDateColumn({ name: "received_at", type: "datetime", precision: 3 })
  receivedAt!: Date;
}

@Entity("audit_events")
@Index(["merchantId", "createdAt"])
@Index(["resourceType", "resourceId"])
export class AuditEventEntity {
  @PrimaryColumn({ type: "char", length: 36 })
  id!: string;

  @Column({ name: "merchant_id", type: "char", length: 36 })
  merchantId!: string;

  @Column({ name: "actor_subject", type: "varchar", length: 120 })
  actorSubject!: string;

  @Column({ type: "varchar", length: 120 })
  action!: string;

  @Column({ name: "resource_type", type: "varchar", length: 80 })
  resourceType!: string;

  @Column({ name: "resource_id", type: "varchar", length: 120 })
  resourceId!: string;

  @Column({ name: "request_id", type: "varchar", length: 128, nullable: true })
  requestId!: string | null;

  @Column({ type: "json" })
  details!: object;

  @CreateDateColumn({ name: "created_at", type: "datetime", precision: 3 })
  createdAt!: Date;
}

export const persistenceEntities = [
  MerchantEntity,
  StoreEntity,
  InvoiceEntity,
  InvoiceLineEntity,
  IdempotencyRecordEntity,
  OutboxEventEntity,
  DeliveryAttemptEntity,
  PaymentEntity,
  RefundEntity,
  PaymentWebhookReceiptEntity,
  AuditEventEntity
];
