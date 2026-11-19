-- Initial database schema
-- Created: 2023-10-01

CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'pending', 'suspended')),
    created_at DATE NOT NULL,
    total_spent REAL DEFAULT 0.0
);

CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL,
    in_stock INTEGER DEFAULT 0
);

CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    sale_date DATE NOT NULL,
    quantity INTEGER NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('completed', 'refunded', 'pending')),
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);