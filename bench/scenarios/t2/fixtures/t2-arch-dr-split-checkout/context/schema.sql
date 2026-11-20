-- Snapshot of relevant tables in commerce-primary, 2025-02-14
CREATE TABLE customer (
  customer_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  default_address JSONB,
  marketing_opt_in BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE orders (
  order_id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customer(customer_id),
  checkout_token TEXT NOT NULL UNIQUE,
  payment_status TEXT NOT NULL,
  fulfillment_status TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE order_items (
  order_id UUID NOT NULL REFERENCES orders(order_id),
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  PRIMARY KEY (order_id, sku)
);

CREATE TABLE payment_attempts (
  attempt_id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE inventory_reservations (
  reservation_id UUID PRIMARY KEY,
  order_id UUID NOT NULL,
  sku TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
