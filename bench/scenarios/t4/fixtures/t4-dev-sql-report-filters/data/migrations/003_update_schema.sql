-- Schema updates for v1.0
-- Created: 2023-10-10

-- Add notes field to customers (optional)
ALTER TABLE customers ADD COLUMN notes TEXT;

-- Add discount field to sales
ALTER TABLE sales ADD COLUMN discount REAL DEFAULT 0.0;