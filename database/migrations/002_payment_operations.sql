ALTER TABLE invoices
  MODIFY status ENUM(
    'DRAFT',
    'ISSUED',
    'PARTIALLY_PAID',
    'PAID',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'ISSUED';

ALTER TABLE idempotency_records
  ADD KEY idx_idempotency_created (created_at);

ALTER TABLE delivery_attempts
  ADD KEY idx_delivery_created (created_at);

ALTER TABLE outbox_events
  ADD COLUMN merchant_id CHAR(36) NULL AFTER aggregate_id;

UPDATE outbox_events AS event
INNER JOIN invoices AS invoice ON invoice.id = event.aggregate_id
SET event.merchant_id = invoice.merchant_id
WHERE event.merchant_id IS NULL;

ALTER TABLE outbox_events
  MODIFY merchant_id CHAR(36) NOT NULL,
  ADD KEY idx_outbox_merchant_created (merchant_id, created_at),
  ADD KEY idx_outbox_published (status, published_at),
  ADD CONSTRAINT fk_outbox_merchant
    FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT;

CREATE TABLE payments (
  id CHAR(36) NOT NULL,
  merchant_id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_payment_id VARCHAR(120) NOT NULL,
  amount_minor INT UNSIGNED NOT NULL,
  refunded_minor INT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  status ENUM('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED') NOT NULL DEFAULT 'CAPTURED',
  captured_at DATETIME(3) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_provider_payment (provider, provider_payment_id),
  KEY idx_payments_merchant_created (merchant_id, created_at),
  KEY idx_payments_invoice_status (invoice_id, status),
  CONSTRAINT fk_payments_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,
  CONSTRAINT chk_payments_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT chk_payments_refund_total CHECK (refunded_minor <= amount_minor)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE refunds (
  id CHAR(36) NOT NULL,
  merchant_id CHAR(36) NOT NULL,
  payment_id CHAR(36) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_refund_id VARCHAR(120) NOT NULL,
  amount_minor INT UNSIGNED NOT NULL,
  refunded_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_provider_refund (provider, provider_refund_id),
  KEY idx_refunds_merchant_created (merchant_id, created_at),
  KEY idx_refunds_payment (payment_id),
  CONSTRAINT fk_refunds_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT chk_refunds_amount_positive CHECK (amount_minor > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE payment_webhook_receipts (
  id CHAR(36) NOT NULL,
  provider VARCHAR(40) NOT NULL,
  provider_event_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_webhook_provider_event (provider, provider_event_id),
  KEY idx_payment_webhook_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_events (
  id CHAR(36) NOT NULL,
  merchant_id CHAR(36) NOT NULL,
  actor_subject VARCHAR(120) NOT NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(120) NOT NULL,
  request_id VARCHAR(128) NULL,
  details JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_audit_merchant_created (merchant_id, created_at),
  KEY idx_audit_resource (resource_type, resource_id),
  CONSTRAINT fk_audit_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TRIGGER audit_events_block_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';

CREATE TRIGGER audit_events_block_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_events is append-only';
