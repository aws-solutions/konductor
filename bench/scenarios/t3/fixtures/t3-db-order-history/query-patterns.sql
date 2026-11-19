-- Query patterns that must be supported efficiently
-- Use these to test your schema design with EXPLAIN QUERY PLAN

-- Pattern 1: Customer's recent orders (newest first)
-- Expected to return 0-100 rows per customer
SELECT * FROM order_history 
WHERE customer_id = ?
ORDER BY order_date DESC 
LIMIT 50;

-- Pattern 2: Look up specific order by order number
-- Exact match, should return 0 or 1 row
SELECT * FROM order_history 
WHERE order_number = ?;

-- Pattern 3: View all items in a specific order
-- Returns 1-15 rows typically
SELECT * FROM order_history 
WHERE order_id = ?
ORDER BY line_number;

-- Pattern 4: Open orders by warehouse for fulfillment
-- Returns variable number of rows (typically < 1000 per warehouse)
SELECT * FROM order_history 
WHERE warehouse_id = ? 
  AND status IN ('pending', 'processing')
ORDER BY order_date;

-- Pattern 5: Order status check (similar to pattern 2 but might use status)
SELECT order_number, status, customer_id 
FROM order_history 
WHERE order_number = ?;

-- Pattern 6: Orders by date range for finance reporting
-- Could scan large date ranges (up to 30 days)
SELECT 
  DATE(order_date) as order_day,
  COUNT(*) as order_count,
  SUM(total_amount) as daily_revenue
FROM order_history 
WHERE order_date BETWEEN ? AND ?
  AND status != 'cancelled'
GROUP BY DATE(order_date)
ORDER BY order_day;

-- Pattern 7: Product performance by date range
-- Used for inventory planning
SELECT 
  product_id,
  product_sku,
  COUNT(*) as units_sold,
  SUM(quantity) as total_quantity,
  SUM(line_total) as revenue
FROM order_history 
WHERE order_date BETWEEN ? AND ?
  AND status = 'delivered'
GROUP BY product_id, product_sku
ORDER BY revenue DESC
LIMIT 100;

-- Additional validation queries for constraints:
-- Check unique order_number
INSERT INTO order_history (order_number, customer_id, ...) VALUES ('ORD123', 456, ...);
-- Should fail on duplicate:
INSERT INTO order_history (order_number, customer_id, ...) VALUES ('ORD123', 789, ...);

-- Check NOT NULL constraints
INSERT INTO order_history (order_number, customer_id) VALUES ('ORD124', NULL);
-- Should fail due to NOT NULL constraint

-- Performance testing notes:
-- 1. Run EXPLAIN QUERY PLAN before each query to verify index usage
-- 2. Look for "SCAN" operations on large tables - these should be "SEARCH" instead
-- 3. Test with realistic data volumes (900M rows simulated)
-- 4. Verify that composite indexes are being used appropriately
-- 5. Check that queries don't require temporary tables or filesort operations

-- Sample EXPLAIN QUERY PLAN usage:
-- EXPLAIN QUERY PLAN SELECT * FROM order_history WHERE customer_id = 123 ORDER BY order_date DESC LIMIT 50;
-- Should show: "SEARCH order_history USING INDEX idx_customer_order_date (customer_id=?)"