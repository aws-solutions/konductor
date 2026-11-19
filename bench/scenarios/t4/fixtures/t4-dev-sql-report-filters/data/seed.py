#!/usr/bin/env python3
"""Seed the demo database with sample data."""
import sqlite3
import os
import sys
import random
from datetime import datetime, timedelta
import argparse


def create_tables(conn: sqlite3.Connection):
    """Create database tables."""
    cursor = conn.cursor()
    
    # Customers table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'pending', 'suspended')),
            created_at DATE NOT NULL,
            total_spent REAL DEFAULT 0.0
        )
    """)
    
    # Products table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            price REAL NOT NULL,
            in_stock INTEGER DEFAULT 0
        )
    """)
    
    # Sales table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            sale_date DATE NOT NULL,
            quantity INTEGER NOT NULL,
            amount REAL NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('completed', 'refunded', 'pending')),
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    """)
    
    # Create indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(created_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(product_id)")
    
    conn.commit()


def seed_customers(conn: sqlite3.Connection, count: int = 50):
    """Seed customers table."""
    cursor = conn.cursor()
    
    # Clear existing data
    cursor.execute("DELETE FROM customers")
    
    first_names = ['John', 'Jane', 'Robert', 'Emily', 'Michael', 'Sarah', 'David', 'Lisa', 
                   'William', 'Karen', 'Richard', 'Nancy', 'Joseph', 'Betty', 'Thomas', 'Sandra']
    last_names = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
                  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson']
    
    statuses = ['active', 'inactive', 'pending', 'suspended']
    
    for i in range(count):
        first = random.choice(first_names)
        last = random.choice(last_names)
        name = f"{first} {last}"
        email = f"{first.lower()}.{last.lower()}@example.com"
        status = random.choice(statuses)
        
        # Random date in the past 2 years
        days_ago = random.randint(0, 730)
        created_at = (datetime.now() - timedelta(days=days_ago)).strftime('%Y-%m-%d')
        
        cursor.execute(
            "INSERT INTO customers (name, email, status, created_at, total_spent) VALUES (?, ?, ?, ?, ?)",
            (name, email, status, created_at, random.uniform(100, 10000))
        )
    
    conn.commit()
    print(f"Seeded {count} customers")


def seed_products(conn: sqlite3.Connection):
    """Seed products table."""
    cursor = conn.cursor()
    
    # Clear existing data
    cursor.execute("DELETE FROM products")
    
    products = [
        ('Laptop Pro', 'Electronics', 1299.99, 50),
        ('Wireless Mouse', 'Electronics', 29.99, 200),
        ('Office Chair', 'Furniture', 199.99, 30),
        ('Desk Lamp', 'Home', 39.99, 150),
        ('Notebook', 'Office', 9.99, 500),
        ('Coffee Maker', 'Home', 79.99, 80),
        ('Backpack', 'Accessories', 49.99, 120),
        ('Water Bottle', 'Accessories', 19.99, 300),
        ('Monitor 24"', 'Electronics', 249.99, 40),
        ('Keyboard', 'Electronics', 59.99, 100),
    ]
    
    for name, category, price, stock in products:
        cursor.execute(
            "INSERT INTO products (name, category, price, in_stock) VALUES (?, ?, ?, ?)",
            (name, category, price, stock)
        )
    
    conn.commit()
    print(f"Seeded {len(products)} products")


def seed_sales(conn: sqlite3.Connection, count: int = 200):
    """Seed sales table."""
    cursor = conn.cursor()
    
    # Clear existing data
    cursor.execute("DELETE FROM sales")
    
    # Get customer IDs
    cursor.execute("SELECT id FROM customers")
    customer_ids = [row[0] for row in cursor.fetchall()]
    
    # Get product IDs
    cursor.execute("SELECT id, price FROM products")
    products = [(row[0], row[1]) for row in cursor.fetchall()]
    
    statuses = ['completed', 'refunded', 'pending']
    
    for i in range(count):
        customer_id = random.choice(customer_ids)
        product_id, product_price = random.choice(products)
        
        # Random date in the past year
        days_ago = random.randint(0, 365)
        sale_date = (datetime.now() - timedelta(days=days_ago)).strftime('%Y-%m-%d')
        
        quantity = random.randint(1, 5)
        amount = round(product_price * quantity, 2)
        status = random.choice(statuses)
        
        cursor.execute(
            """INSERT INTO sales (customer_id, product_id, sale_date, quantity, amount, status) 
               VALUES (?, ?, ?, ?, ?, ?)""",
            (customer_id, product_id, sale_date, quantity, amount, status)
        )
    
    conn.commit()
    
    # Update customer total_spent
    cursor.execute("""
        UPDATE customers 
        SET total_spent = (
            SELECT COALESCE(SUM(amount), 0)
            FROM sales 
            WHERE sales.customer_id = customers.id AND sales.status = 'completed'
        )
    """)
    
    conn.commit()
    print(f"Seeded {count} sales")


def check_database(db_path: str):
    """Check if database exists and has data."""
    if not os.path.exists(db_path):
        return False
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        required_tables = {'customers', 'products', 'sales'}
        if not required_tables.issubset(set(tables)):
            return False
        
        # Check each table has data
        for table in required_tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            if count == 0:
                return False
        
        conn.close()
        return True
    except sqlite3.Error:
        return False


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Seed demo database')
    parser.add_argument('--db-path', default='data/reports.db', help='Database file path')
    parser.add_argument('--check', action='store_true', help='Check if database is properly seeded')
    parser.add_argument('--force', action='store_true', help='Force recreation of database')
    args = parser.parse_args()
    
    # Create data directory if it doesn't exist
    os.makedirs(os.path.dirname(args.db_path), exist_ok=True)
    
    if args.check:
        if check_database(args.db_path):
            print("Database is properly seeded")
            return 0
        else:
            print("Database is not properly seeded")
            return 1
    
    # Remove existing database if force flag is set
    if args.force and os.path.exists(args.db_path):
        os.remove(args.db_path)
    
    # Connect to database
    conn = sqlite3.connect(args.db_path)
    
    try:
        # Create tables
        create_tables(conn)
        
        # Seed data
        seed_customers(conn, 50)
        seed_products(conn)
        seed_sales(conn, 200)
        
        print("Database seeded successfully")
        return 0
    except Exception as e:
        print(f"Error seeding database: {e}")
        return 1
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())