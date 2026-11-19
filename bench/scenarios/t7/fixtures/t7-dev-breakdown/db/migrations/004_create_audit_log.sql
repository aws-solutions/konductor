CREATE TABLE price_audit_log (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
