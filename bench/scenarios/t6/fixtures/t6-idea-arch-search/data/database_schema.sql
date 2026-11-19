-- AutoPartsDirect Database Schema
-- Version: 2023.11.01

-- Products table
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    part_number VARCHAR(32) NOT NULL,
    normalized_part_number VARCHAR(32),
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    brand VARCHAR(100),
    price DECIMAL(10,2) NOT NULL,
    in_stock BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Search logs table
CREATE TABLE search_logs (
    id SERIAL PRIMARY KEY,
    query TEXT NOT NULL,
    result_count INTEGER NOT NULL,
    session_id VARCHAR(100),
    user_id VARCHAR(100),
    device_type VARCHAR(50),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_products_part_number ON products(part_number);
CREATE INDEX idx_products_normalized_part_number ON products(normalized_part_number);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_brand ON products(brand);

-- Full-text search index
CREATE INDEX idx_products_search ON products USING GIN (
    to_tsvector('english', description)
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at
CREATE TRIGGER update_products_updated_at 
    BEFORE UPDATE ON products 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Sample data (for testing)
INSERT INTO products (part_number, description, category, price) VALUES
('AP1234567', 'Brake Pad Set - Front', 'Brakes', 89.99),
('AP1234567A', 'Brake Pad Set - Front (Premium)', 'Brakes', 129.99),
('AP-987-654', 'Oil Filter - Standard', 'Filters', 12.99),
('AP 111 222', 'Air Filter - Cabin', 'Filters', 24.99),
('001234567', 'Spark Plug Set', 'Ignition', 45.99);