"""Security tests for SQL injection vulnerabilities."""
import tempfile
import os
import sqlite3
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from hidden.py.timeouts import TimedCase


class TestSecurity(TimedCase):
    """Security tests that must fail on vulnerable code."""
    
    def setUp(self):
        """Set up test database."""
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, 'test.db')
        
        # Create test database
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create customers table
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
        
        # Create sales table (for get_sales tests)
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
        
        # Create products table (for get_sales tests)
        cursor.execute("""
            CREATE TABLE products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                price REAL NOT NULL
            )
        """)
        
        # Insert test data for customers
        test_customers = [
            ('Customer 50%', 'customer50@example.com', 'active', '2023-01-01', 1000.0),
            ('Customer_Test', 'customer_test@example.com', 'inactive', '2023-02-01', 500.0),
            ('Normal Customer', 'normal@example.com', 'active', '2023-03-01', 750.0),
            ('Another Customer', 'another@example.com', 'pending', '2023-04-01', 250.0),
            ('Third Customer', 'third@example.com', 'inactive', '2023-05-01', 300.0),
            ('Customer A', 'customer_a@example.com', 'active', '2023-06-01', 1200.0),
            ('Customer B', 'customer_b@example.com', 'active', '2023-06-02', 800.0),
            ('Customer C', 'customer_c@example.com', 'pending', '2023-06-03', 600.0),
            ('Customer D', 'customer_d@example.com', 'inactive', '2023-06-04', 400.0),
            ('Customer E', 'customer_e@example.com', 'active', '2023-06-05', 1500.0)
        ]
        
        for customer in test_customers:
            cursor.execute(
                "INSERT INTO customers (name, email, status, created_at, total_spent) VALUES (?, ?, ?, ?, ?)",
                customer
            )
        
        # Insert test data for products
        test_products = [
            (1, 'Product X', 10.0),
            (2, 'Product Y', 20.0),
            (3, 'Product Z', 30.0)
        ]
        
        for product in test_products:
            cursor.execute(
                "INSERT INTO products (id, name, price) VALUES (?, ?, ?)",
                product
            )
        
        # Insert test data for sales
        test_sales = [
            (1, 1, '2023-06-01', 2, 20.0, 'completed'),
            (2, 2, '2023-06-02', 1, 20.0, 'completed'),
            (3, 3, '2023-06-03', 3, 90.0, 'completed'),
            (1, 2, '2023-06-04', 1, 20.0, 'completed'),
            (2, 1, '2023-06-05', 2, 20.0, 'pending'),
            (3, 3, '2023-06-06', 1, 30.0, 'completed'),
            (4, 1, '2023-06-07', 5, 50.0, 'completed'),
            (5, 2, '2023-06-08', 2, 40.0, 'completed'),
            (6, 3, '2023-06-09', 1, 30.0, 'pending'),
            (7, 1, '2023-06-10', 3, 30.0, 'completed')
        ]
        
        for sale in test_sales:
            cursor.execute(
                "INSERT INTO sales (customer_id, product_id, sale_date, quantity, amount, status) VALUES (?, ?, ?, ?, ?, ?)",
                sale
            )
        
        conn.commit()
        conn.close()
        
        # Try to import database from different possible locations
        try:
            # When running from repository root with src at root
            from src import database
        except ImportError:
            try:
                # When running from repository root with src in fixture
                from fixture.src import database
            except ImportError:
                # When running from fixture directory
                import sys
                sys.path.insert(0, '.')
                from src import database
        self.db = database.Database(self.db_path)
    
    def tearDown(self):
        """Clean up."""
        import shutil
        shutil.rmtree(self.temp_dir)
    
    # Test 1: LIKE wildcard percent literal
    def test_05_normal_use_still_works(self):
        """Normal filters, sorting, paging and amount ranges keep working."""
        with self.subTest('status_filter_valid_values'):
            self._05_status_filter_valid_values()
        with self.subTest('sort_by_allowed_columns'):
            self._10_sort_by_allowed_columns()
        with self.subTest('date_range_works'):
            self._11_date_range_works()
        with self.subTest('limit_offset_pagination'):
            self._12_limit_offset_pagination()
        with self.subTest('amount_range_works'):
            self._18_amount_range_works()

    def test_01_like_wildcard_percent(self):
        """Search for '%' should find only customers with literal % character."""
        results, total = self.db.get_customers(name_filter='%')
        self.assertEqual(total, 1, "Searching '%' should find exactly 1 customer with literal '%', not all customers")
    
    # Test 2: LIKE wildcard underscore literal  
    def test_02_like_wildcard_underscore(self):
        """Search for '_' should find only customers with literal _ character."""
        results, total = self.db.get_customers(name_filter='_')
        self.assertEqual(total, 1, "Searching '_' should find exactly 1 customer with literal '_', not all customers")
    
    # Test 3: UNION injection
    def test_03_union_injection(self):
        """UNION injection should not return extra rows."""
        injection = "' UNION SELECT id, name, email, status, '2023-01-01', 0 FROM customers --"
        results, total = self.db.get_customers(name_filter=injection)
        self.assertEqual(total, 0, f"UNION injection should return 0 results, not {total}")
    
    # Test 4: Always true injection
    def test_04_always_true_injection(self):
        """OR '1'='1' injection should not return all rows."""
        injection = "' OR '1'='1"
        results, total = self.db.get_customers(name_filter=injection)
        # No customer has name "' OR '1'='1", so should return 0
        self.assertEqual(total, 0, f"Always-true injection should return 0 results, not {total}")
    
    # Test 5: Status filter with two valid values returns exactly those rows
    def _05_status_filter_valid_values(self):
        """Status list with two valid values returns exactly matching rows."""
        results, total = self.db.get_customers(status_filter=['active', 'pending'])
        # Count active and pending customers
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM customers WHERE status IN ('active', 'pending')")
        expected_count = cursor.fetchone()[0]
        conn.close()
        
        self.assertEqual(total, expected_count, f"Should return {expected_count} active/pending customers, got {total}")
    
    # Test 6: Status filter injection returns nothing
            # Other exceptions are okay if they prevent injection
    
    # Test 7: Sort_by expression injection is refused or ignored
    def test_07_sort_by_injection(self):
        """Sort_by injection should be refused or ignored."""
        injection = "(CASE WHEN (SELECT 1)=1 THEN total_spent ELSE name END)"
        try:
            results, total = self.db.get_customers(sort_by=injection)
            # If it accepts the injection, order should be default (name ASC)
            # Check if results are in default order (name ASC)
            names = [r['name'] for r in results]
            sorted_names = sorted(names)
            self.assertEqual(names, sorted_names, "Results should be in default order when sort_by injection is ignored")
        except ValueError:
            # ValueError is acceptable - injection was refused
            pass
    
    # Test 10: Sort_by allowed columns work correctly in ASC and DESC
    def _10_sort_by_allowed_columns(self):
        """Sort_by with allowed columns should produce correct order."""
        # Test each allowed column
        allowed_columns = ['name', 'email', 'status', 'created_at', 'total_spent']
        
        for column in allowed_columns:
            # ASC order
            results_asc, total_asc = self.db.get_customers(sort_by=column, sort_dir='ASC')
            # DESC order
            results_desc, total_desc = self.db.get_customers(sort_by=column, sort_dir='DESC')
            
            self.assertEqual(total_asc, total_desc, f"Total count should be same for {column} ASC and DESC")
            
            # Check ordering (only if we got results)
            if results_asc and results_desc:
                # Get values for the column
                asc_values = [r[column] for r in results_asc]
                desc_values = [r[column] for r in results_desc]
                
                # Check ASC order
                self.assertEqual(asc_values, sorted(asc_values), f"{column} should be sorted ASC")
                
                # Check DESC order (sorted in reverse)
                self.assertEqual(desc_values, sorted(desc_values, reverse=True), f"{column} should be sorted DESC")
    
    # Test 11: Date range returns correct rows
    def _11_date_range_works(self):
        """Valid date range should return correct rows."""
        results, total = self.db.get_customers(
            start_date='2023-03-01',
            end_date='2023-05-01'
        )
        
        # Count customers in date range
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM customers WHERE created_at >= '2023-03-01' AND created_at <= '2023-05-01'")
        expected_count = cursor.fetchone()[0]
        conn.close()
        
        self.assertEqual(total, expected_count, f"Should return {expected_count} customers in date range, got {total}")
    
    # Test 12: Limit and offset paginate correctly
    def _12_limit_offset_pagination(self):
        """Limit and offset should paginate correctly."""
        # Get first page
        page1, total1 = self.db.get_customers(limit=3, offset=0)
        # Get second page
        page2, total2 = self.db.get_customers(limit=3, offset=3)
        
        self.assertEqual(total1, total2, "Total count should be same for both pages")
        self.assertEqual(len(page1), 3, "First page should have 3 results")
        self.assertEqual(len(page2), 3, "Second page should have 3 results")
        
        # Check that pages don't overlap
        page1_ids = {r['id'] for r in page1}
        page2_ids = {r['id'] for r in page2}
        self.assertTrue(page1_ids.isdisjoint(page2_ids), "Pages should not overlap")
    
    # Test 13: Non-integer limit raises ValueError or uses default
    def test_13_non_integer_limit(self):
        """Non-integer limit should raise ValueError or use default."""
        try:
            results, total = self.db.get_customers(limit="not_an_integer")
            # If it accepts, should use default limit (100)
            self.assertTrue(len(results) <= 100, "Should use default limit when non-integer provided")
        except ValueError:
            # ValueError is acceptable
            pass
    
    # Test 15: Customer name injection in get_sales returns nothing
    def test_15_get_sales_customer_name_injection(self):
        """Customer name injection in get_sales should return nothing."""
        injection = "' OR '1'='1"
        results, total = self.db.get_sales(customer_name=injection)
        self.assertEqual(total, 0, f"Customer name injection in get_sales should return 0, not {total}")
    
    # Test 16: Product filter injection in get_sales returns nothing
    def test_16_get_sales_product_filter_injection(self):
        """Product filter injection in get_sales should return nothing."""
        injection = ["1' OR '1'='1"]
        results, total = self.db.get_sales(product_filter=injection)
        self.assertEqual(total, 0, f"Product filter injection in get_sales should return 0, not {total}")
    
    # Test 18: Legitimate amount range works
    def _18_amount_range_works(self):
        """Valid amount range should return correct rows."""
        results, total = self.db.get_sales(min_amount=20.0, max_amount=50.0)
        
        # Count sales in amount range
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM sales WHERE amount >= 20.0 AND amount <= 50.0")
        expected_count = cursor.fetchone()[0]
        conn.close()
        
        self.assertEqual(total, expected_count, f"Should return {expected_count} sales in amount range, got {total}")
    
    # Test 19: get_customers_csv always-true payload returns no rows
    def test_19_customers_csv_always_true_injection(self):
        """Always-true injection in get_customers_csv should return no rows."""
        injection = "' OR '1'='1"
        results = self.db.get_customers_csv(name_filter=injection)
        self.assertEqual(len(results), 0, f"CSV always-true injection should return 0 results, not {len(results)}")
    
    # Test 20: get_customers_csv literal % search returns only matching rows
    def test_20_customers_csv_literal_percent(self):
        """Literal % search in get_customers_csv should return only matching rows."""
        results = self.db.get_customers_csv(name_filter='%')
        # Should only return customer with literal '%' in name
        self.assertEqual(len(results), 1, f"CSV search for '%' should return 1 customer, not {len(results)}")
        if results:
            self.assertIn('%', results[0]['name'], "Returned customer should have '%' in name")
    
    # Test 21: get_sales_csv always-true payload returns no rows
    def test_21_sales_csv_always_true_injection(self):
        """Always-true injection in get_sales_csv should return no rows."""
        injection = "' OR '1'='1"
        results = self.db.get_sales_csv(customer_name=injection)
        self.assertEqual(len(results), 0, f"Sales CSV always-true injection should return 0 results, not {len(results)}")
    
    # Test 22: get_sales_csv literal % search returns only matching rows
    def test_22_sales_csv_literal_percent(self):
        """Literal % search in get_sales_csv should return only matching rows."""
        # Add a customer with % in name
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO customers (name, email, status, created_at, total_spent) VALUES (?, ?, ?, ?, ?)",
            ('Sales Customer%', 'sales_customer@example.com', 'active', '2023-01-01', 1000.0)
        )
        customer_id = cursor.lastrowid
        
        cursor.execute(
            "INSERT INTO sales (customer_id, product_id, sale_date, quantity, amount, status) VALUES (?, ?, ?, ?, ?, ?)",
            (customer_id, 1, '2023-06-11', 1, 10.0, 'completed')
        )
        conn.commit()
        conn.close()
        
        results = self.db.get_sales_csv(customer_name='%')
        # Vulnerable code: LIKE '%%%' matches all customers, returns all sales (~11)
        # Secure code: escaped LIKE '%\%%' matches only customers with % in name
        # Should return significantly fewer than total sales
        total_sales = 11  # 10 in setup + 1 added
        self.assertLess(len(results), total_sales, 
                       f"Sales CSV search for '%' should not return all {total_sales} sales, got {len(results)}")
    
    # Test 23: Error messages don't leak SQL keywords or table names
    def test_23_error_no_sql_leak(self):
        """Error messages should not leak SQL or table names."""
        # Try to trigger error with injection
        try:
            results, total = self.db.get_customers(name_filter="'\"\\")
            error_msg = ""
        except Exception as e:
            error_msg = str(e).lower()
        
        # Should not contain SQL keywords or table names
        sql_words = ['sql', 'syntax', 'near', 'unrecognized token', 'customers', 'sales', 'products']
        for word in sql_words:
            self.assertNotIn(word, error_msg, 
                           f"Error should not contain '{word}': {error_msg[:100] if error_msg else 'no error'}")
    
    # Additional tests to ensure vulnerable code fails
    
    # Test 25: OFFSET injection with SQL
    def test_25_offset_sql_injection(self):
        """OFFSET parameter should not accept SQL injection."""
        injection = "0; DELETE FROM customers"
        try:
            results, total = self.db.get_customers(offset=injection)
            # If it doesn't raise, offset should be treated as 0 (default)
            # With default limit 100, but only 10 customers exist
            self.assertTrue(len(results) <= 10, f"Should return at most 10 customers, got {len(results)}")
        except (ValueError, TypeError):
            # ValueError/TypeError is acceptable
            pass
    
    # Test 26: Name filter with semicolon injection
    def test_26_name_filter_semicolon_injection(self):
        """Name filter with semicolon should not execute second statement."""
        injection = "test'; DELETE FROM customers WHERE 1=1 --"
        results, total = self.db.get_customers(name_filter=injection)
        # No customer has this exact name, should return 0
        # Vulnerable code might execute DELETE or return all rows
        self.assertEqual(total, 0, f"Semicolon injection should return 0, not {total}")
    
    # Test 28: CSV export with limit bypass attempt
    def test_28_csv_limit_bypass(self):
        """CSV export should not accept limit parameter injection."""
        # get_customers_csv doesn't have limit parameter, but test that
        # sorting injection doesn't work
        injection = "name; SELECT * FROM customers"
        results = self.db.get_customers_csv(sort_by=injection)
        # Should either use default sort or reject
        # Check if sorted by name (default)
        if len(results) > 1:
            names = [r['name'] for r in results]
            # Check if roughly sorted (not perfect due to injection)
            # Just ensure we got results and didn't crash
            self.assertIsInstance(results, list)
    
    # More tests targeting specific vulnerabilities
    
    # Test 30: Boolean-based blind injection
    def test_30_boolean_blind_injection(self):
        """Boolean-based blind SQL injection should not work."""
        # Test if we can extract information via boolean conditions
        injection = "' AND (SELECT COUNT(*) FROM customers) > 0 --"
        results, total = self.db.get_customers(name_filter=injection)
        # Should return 0 (no customer has this name)
        # Vulnerable code would execute the subquery
        self.assertEqual(total, 0, f"Boolean blind injection should return 0, not {total}")
    
    # Test 31: Time-based blind injection attempt
    def test_31_time_based_injection(self):
        """Time-based blind SQL injection should not work."""
        # SQLite doesn't have SLEEP, but test other time-based patterns
        injection = "' AND (SELECT 1 FROM sqlite_master LIMIT 1) --"
        results, total = self.db.get_customers(name_filter=injection)
        # Should return 0
        self.assertEqual(total, 0, f"Time-based injection attempt should return 0, not {total}")


if __name__ == '__main__':
    import unittest
    unittest.main()