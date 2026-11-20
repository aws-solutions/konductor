-- release 4.18.0
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code text NULL;

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders (id),
  promo_code text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
