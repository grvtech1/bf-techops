CREATE TABLE IF NOT EXISTS merchants (
  id CHAR(36) NOT NULL,
  parent_merchant_id CHAR(36) NULL,
  name VARCHAR(160) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_merchants_parent (parent_merchant_id),
  CONSTRAINT fk_merchants_parent FOREIGN KEY (parent_merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS stores (
  id CHAR(36) NOT NULL,
  merchant_id CHAR(36) NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_stores_merchant_code (merchant_id, code),
  KEY idx_stores_merchant (merchant_id),
  CONSTRAINT fk_stores_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id CHAR(36) NOT NULL,
  merchant_id CHAR(36) NOT NULL,
  store_id CHAR(36) NOT NULL,
  created_by VARCHAR(120) NOT NULL,
  customer_name VARCHAR(160) NOT NULL,
  customer_contact VARCHAR(254) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  subtotal_minor INT UNSIGNED NOT NULL,
  discount_minor INT UNSIGNED NOT NULL DEFAULT 0,
  tax_rate_basis_points SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  tax_minor INT UNSIGNED NOT NULL DEFAULT 0,
  total_minor INT UNSIGNED NOT NULL,
  status ENUM('DRAFT', 'ISSUED', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
  issued_at DATETIME(3) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_invoices_merchant_created (merchant_id, created_at),
  KEY idx_invoices_store_status (store_id, status),
  CONSTRAINT fk_invoices_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT,
  CONSTRAINT fk_invoices_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS invoice_lines (
  id CHAR(36) NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  description VARCHAR(240) NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL,
  unit_price_minor INT UNSIGNED NOT NULL,
  line_total_minor INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_lines_position (invoice_id, position),
  CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS idempotency_records (
  id CHAR(36) NOT NULL,
  actor_merchant_id CHAR(36) NOT NULL,
  operation VARCHAR(80) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  response_body JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_idempotency_actor_operation_key (actor_merchant_id, operation, idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS outbox_events (
  id CHAR(36) NOT NULL,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id CHAR(36) NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('PENDING', 'PROCESSING', 'PUBLISHED') NOT NULL DEFAULT 'PENDING',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL,
  lock_until DATETIME(3) NULL,
  published_at DATETIME(3) NULL,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_outbox_dispatch (status, available_at, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS delivery_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(36) NOT NULL,
  attempt_number SMALLINT UNSIGNED NOT NULL,
  status ENUM('SUCCEEDED', 'RETRYING', 'DEAD_LETTERED') NOT NULL,
  provider_reference VARCHAR(160) NULL,
  error_code VARCHAR(80) NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_delivery_event_attempt (event_id, attempt_number),
  KEY idx_delivery_event (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
