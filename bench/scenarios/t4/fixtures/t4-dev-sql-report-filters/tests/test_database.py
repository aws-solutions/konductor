"""Tests for the database module."""
import unittest
import tempfile
import os
import sqlite3
from src import database


class TestDatabase(unittest.TestCase):
    """Test database functionality."""
    
    def setUp(self):
        """Set up test database."""
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, 'test.db')
        self.db = database.Database(self.db_path)
        
        # Create test tables
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                status TEXT NOT NULL,
                created_at DATE NOT NULL,
                total_spent REAL DEFAULT 0.0
            )
        """)
        
        cursor.execute("""
            CREATE TABLE products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                price REAL NOT NULL,
                in_stock INTEGER DEFAULT 0
            )
        """)
        
        cursor.execute("""
            CREATE TABLE sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                sale_date DATE NOT NULL,
                quantity INTEGER NOT NULL,
                amount REAL NOT NULL,
                status TEXT NOT NULL
            )
        """)
        
        # Insert test data
        cursor.execute("""
            INSERT INTO customers (name, email, status, created_at, total_spent) 
            VALUES (?, ?, ?, ?, ?)
        """, ('Test Customer', 'test@example.com', 'active', '2023-01-01', 1000.0))
        
        cursor.execute("""
            INSERT INTO customers (name, email, status, created_at, total_spent) 
            VALUES (?, ?, ?, ?, ?)
        """, ('Another Customer', 'another@example.com', 'inactive', '2023-02-01', 500.0))
        
        cursor.execute("""
            INSERT INTO products (name, category, price, in_stock) 
            VALUES (?, ?, ?, ?)
        """, ('Test Product', 'Test Category', 99.99, 10))
        
        conn.commit()
        conn.close()
    
    def tearDown(self):
        """Clean up test database."""
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_get_connection(self):
        """Test database connection."""
        conn = self.db.get_connection()
        self.assertIsInstance(conn, sqlite3.Connection)
        conn.close()
    
    def test_execute_query(self):
        """Test executing a simple query."""
        results = self.db.execute_query("SELECT * FROM customers WHERE status = ?", ('active',))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['name'], 'Test Customer')
    
    def test_get_customers_basic(self):
        """Test basic customer query."""
        results, total = self.db.get_customers()
        self.assertEqual(len(results), 2)
        self.assertEqual(total, 2)
    
    def test_get_customers_name_filter(self):
        """Test customer query with name filter."""
        results, total = self.db.get_customers(name_filter='Test')
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['name'], 'Test Customer')
    
    def test_get_customers_status_filter(self):
        """Test customer query with status filter."""
        results, total = self.db.get_customers(status_filter=['active'])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['status'], 'active')
    
    def test_get_customers_pagination(self):
        """Test customer query with pagination."""
        results, total = self.db.get_customers(limit=1, offset=0)
        self.assertEqual(len(results), 1)
        self.assertEqual(total, 2)
        
        results2, total2 = self.db.get_customers(limit=1, offset=1)
        self.assertEqual(len(results2), 1)
        self.assertEqual(total2, 2)
        self.assertNotEqual(results[0]['id'], results2[0]['id'])
    
    def test_get_customers_csv(self):
        """Test CSV export query."""
        results = self.db.get_customers_csv()
        self.assertEqual(len(results), 2)
    
    def test_get_sales_basic(self):
        """Test basic sales query."""
        # Add a sale record
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sales (customer_id, product_id, sale_date, quantity, amount, status)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (1, 1, '2023-03-01', 2, 199.98, 'completed'))
        conn.commit()
        conn.close()
        
        results, total = self.db.get_sales()
        self.assertEqual(len(results), 1)
        self.assertEqual(total, 1)


if __name__ == '__main__':
    unittest.main()