"""
Order repository tests.
"""

import os
import tempfile
import unittest
from decimal import Decimal

from src.orders.database import Database
from src.orders.repository import Order, OrderRepository
from src.orders.migrate import MigrationRunner


class TestOrderRepository(unittest.TestCase):
    """Test order repository operations."""
    
    def setUp(self):
        self.temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.db_path = self.temp_file.name
        self.db = Database(self.db_path)
        
        # Run migrations to set up schema
        runner = MigrationRunner(self.db)
        runner.run("up", "migration_002_add_notes")
        
        self.repo = OrderRepository(self.db)
    
    def tearDown(self):
        self.db.disconnect()
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)
    
    def test_create_order(self):
        """Test creating an order."""
        order = Order(
            customer_id=123,
            amount=Decimal("99.99"),
            status="pending",
            notes="Test order"
        )
        
        created = self.repo.create(order)
        self.assertIsNotNone(created.id)
        self.assertEqual(created.customer_id, 123)
        self.assertEqual(created.amount, Decimal("99.99"))
        self.assertEqual(created.status, "pending")
        self.assertEqual(created.notes, "Test order")
    
    def test_find_by_id(self):
        """Test finding order by ID."""
        order = Order(customer_id=456, amount=Decimal("50.00"))
        created = self.repo.create(order)
        
        found = self.repo.find_by_id(created.id)
        self.assertIsNotNone(found)
        self.assertEqual(found.id, created.id)
        self.assertEqual(found.customer_id, 456)
        self.assertEqual(found.amount, Decimal("50.00"))
    
    def test_find_by_id_not_found(self):
        """Test finding non-existent order."""
        found = self.repo.find_by_id(99999)
        self.assertIsNone(found)
    
    def test_update_status(self):
        """Test updating order status."""
        order = Order(customer_id=789, amount=Decimal("25.00"))
        created = self.repo.create(order)
        
        updated = self.repo.update_status(created.id, "processing")
        self.assertTrue(updated)
        
        found = self.repo.find_by_id(created.id)
        self.assertEqual(found.status, "processing")
    
    def test_find_by_customer(self):
        """Test finding orders by customer."""
        # Create multiple orders for same customer
        for i in range(3):
            order = Order(customer_id=100, amount=Decimal(f"{10 * i}.00"))
            self.repo.create(order)
        
        orders = self.repo.find_by_customer(100)
        self.assertEqual(len(orders), 3)
        self.assertTrue(all(o.customer_id == 100 for o in orders))
    
    def test_count_by_status(self):
        """Test counting orders by status."""
        # Create orders with different statuses
        statuses = ["pending", "processing", "pending", "shipped"]
        for status in statuses:
            order = Order(customer_id=200, amount=Decimal("15.00"), status=status)
            self.repo.create(order)
        
        pending_count = self.repo.count_by_status("pending")
        self.assertEqual(pending_count, 2)
        
        shipped_count = self.repo.count_by_status("shipped")
        self.assertEqual(shipped_count, 1)


if __name__ == "__main__":
    unittest.main()