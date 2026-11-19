"""Tests for the server module."""
import unittest
import tempfile
import os
import sqlite3
from unittest.mock import Mock, patch


class TestParameterParsing(unittest.TestCase):
    """Test parameter parsing functionality."""
    
    def test_parse_list_param(self):
        """Test list parameter parsing."""
        from src.server import RequestHandler
        
        # Create a minimal handler mock
        handler = Mock(spec=RequestHandler)
        handler._parse_list_param = RequestHandler._parse_list_param.__get__(handler)
        
        result = handler._parse_list_param('active,pending,suspended')
        self.assertEqual(result, ['active', 'pending', 'suspended'])
    
    def test_parse_list_param_empty(self):
        """Test empty list parameter parsing."""
        from src.server import RequestHandler
        
        handler = Mock(spec=RequestHandler)
        handler._parse_list_param = RequestHandler._parse_list_param.__get__(handler)
        
        result = handler._parse_list_param('')
        self.assertIsNone(result)
    
    def test_parse_list_param_none(self):
        """Test None list parameter parsing."""
        from src.server import RequestHandler
        
        handler = Mock(spec=RequestHandler)
        handler._parse_list_param = RequestHandler._parse_list_param.__get__(handler)
        
        result = handler._parse_list_param(None)
        self.assertIsNone(result)


class TestIntegration(unittest.TestCase):
    """Integration tests that require database."""
    
    def setUp(self):
        """Set up test database."""
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, 'test.db')
        
        # Create test database
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
            INSERT INTO customers (name, email, status, created_at, total_spent) 
            VALUES (?, ?, ?, ?, ?)
        """, ('Test Customer', 'test@example.com', 'active', '2023-01-01', 1000.0))
        
        cursor.execute("""
            INSERT INTO customers (name, email, status, created_at, total_spent) 
            VALUES (?, ?, ?, ?, ?)
        """, ('Another Customer', 'another@example.com', 'inactive', '2023-02-01', 500.0))
        
        conn.commit()
        conn.close()
        
        # Patch database path
        self.db_patch = patch('src.database.Database.__init__', 
                            lambda self, db_path=self.db_path: setattr(self, 'db_path', db_path))
        self.db_patch.start()
        
        from src import database
        self.db = database.Database()
    
    def tearDown(self):
        """Clean up."""
        self.db_patch.stop()
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_database_get_customers_integration(self):
        """Test database integration."""
        from src import database
        db = database.Database(self.db_path)
        
        results, total = db.get_customers()
        self.assertEqual(len(results), 2)
        self.assertEqual(total, 2)


if __name__ == '__main__':
    unittest.main()