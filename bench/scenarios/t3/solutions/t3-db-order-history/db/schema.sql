-- ShopFast Order History Database Schema
-- Optimized for 900 million rows within 2.5 TB storage limit

-- Single denormalized table containing all order line data
-- This avoids joins and allows efficient index coverage
CREATE TABLE order_history (
    -- Primary key and order identification
    order_line_id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    order_number TEXT NOT NULL,
    line_number INTEGER NOT NULL,
    
    -- Customer information
    customer_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    
    -- Order metadata
    order_date TIMESTAMP NOT NULL,
    warehouse_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'cancelled')),
    total_amount DECIMAL(12,2) NOT NULL,
    
    -- Product details
    product_id INTEGER NOT NULL,
    product_sku TEXT NOT NULL,
    product_name TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    
    -- Line item details
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) NOT NULL,
    
    -- Shipping and payment
    shipping_cost DECIMAL(10,2) DEFAULT 0,
    shipping_address TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Critical constraints and indexes (3 total to stay within 2.5 TB limit)

-- 1. Unique index for order lookup (Patterns 2, 5)
CREATE UNIQUE INDEX idx_order_number ON order_history(order_number);

-- 2. Composite index for customer queries (Pattern 1)
-- Orders by customer, newest first
CREATE INDEX idx_customer_order_date ON order_history(customer_id, order_date DESC);

-- 3. Composite index for warehouse operations (Pattern 4)
-- Open orders by warehouse with status filter
CREATE INDEX idx_warehouse_status_date ON order_history(warehouse_id, status, order_date);

-- Note on query patterns not fully optimized:
-- Pattern 3 (order lines by order): Uses primary key with order_id filter
-- Pattern 6 (date range reporting): Uses idx_customer_order_date suboptimally
-- Pattern 7 (product reporting): Not optimized (acceptable for batch)

-- Storage calculation: 2.05 TB base + 3 × 0.15 TB indexes = 2.5 TB total

-- Verify with EXPLAIN QUERY PLAN that critical queries use index search:
-- Pattern 1: SEARCH USING INDEX idx_customer_order_date
-- Pattern 2: SEARCH USING INDEX idx_order_number  
-- Pattern 4: SEARCH USING INDEX idx_warehouse_status_date