"""
Database connection tests.
"""

import os
import tempfile
import unittest

from src.orders.database import Database


class TestDatabase(unittest.TestCase):
    """Test database connection management."""
    
    def setUp(self):
        self.temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.db_path = self.temp_file.name
        self.db = Database(self.db_path)
    
    def tearDown(self):
        self.db.disconnect()
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)
    
    def test_connect(self):
        """Test database connection."""
        conn = self.db.connect()
        self.assertIsNotNone(conn)
        
        # Should be able to execute queries
        cursor = conn.execute("SELECT 1")
        result = cursor.fetchone()
        self.assertEqual(result[0], 1)
    
    def test_execute(self):
        """Test query execution."""
        self.db.execute("CREATE TABLE test (id INTEGER)")
        self.db.commit()
        
        cursor = self.db.execute("INSERT INTO test VALUES (42)")
        self.db.commit()
        
        cursor = self.db.execute("SELECT id FROM test")
        result = cursor.fetchone()
        self.assertEqual(result[0], 42)
    
    def test_executemany(self):
        """Test batch execution."""
        self.db.execute("CREATE TABLE test (id INTEGER, name TEXT)")
        self.db.commit()
        
        params = [(1, "Alice"), (2, "Bob"), (3, "Charlie")]
        self.db.executemany("INSERT INTO test VALUES (?, ?)", params)
        self.db.commit()
        
        cursor = self.db.execute("SELECT COUNT(*) FROM test")
        result = cursor.fetchone()
        self.assertEqual(result[0], 3)


if __name__ == "__main__":
    unittest.main()