"""
Tests for order report repository.
"""

import os
import tempfile
import unittest
from datetime import datetime, timedelta
from decimal import Decimal

from src.orders.database import Database
from src.orders.migrate import MigrationRunner
from src.orders.repository import OrderRepository, Order
from src.orders.report_repository import OrderReportRepository


class TestOrderReportRepository(unittest.TestCase):
    """Test order reporting operations."""
    
    def setUp(self):
        self.temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.db_path = self.temp_file.name
        self.db = Database(self.db_path)
        
        # Run migrations including the new one
        runner = MigrationRunner(self.db)
        runner.run("up", "migration_003_add_fulfilment_status")
        
        self.repo = OrderRepository(self.db)
        self.report_repo = OrderReportRepository(self.db)
        
        # Create test data - fulfilment_status will be set by DEFAULT 'pending'
        # and then we need to update some to different values
        test_data = [
            (101, Decimal("10.00"), "pending"),
            (101, Decimal("20.00"), "processing"),
            (101, Decimal("30.00"), "shipped"),
            (102, Decimal("40.00"), "cancelled"),
            (102, Decimal("50.00"), "pending"),
        ]
        
        for customer_id, amount, status in test_data:
            self.repo.create(
                Order(customer_id=customer_id, amount=amount, status=status)
            )
        
        # Now update fulfilment_status based on status
        # shipped -> complete, cancelled -> cancelled, others -> pending
        self.db.execute("""
            UPDATE orders 
            SET fulfilment_status = CASE
                WHEN status = 'shipped' THEN 'complete'
                WHEN status = 'cancelled' THEN 'cancelled'
                ELSE 'pending'
            END
        """)
        
        self.db.commit()
    
    def tearDown(self):
        self.db.disconnect()
        if os.path.exists(self.db_path):
            os.unlink(self.db_path)
    
    def test_get_fulfilment_summary(self):
        """Test getting fulfilment summary."""
        summary = self.report_repo.get_fulfilment_summary()
        
        expected = {
            "pending": 3,
            "complete": 1,
            "cancelled": 1
        }
        
        self.assertEqual(summary, expected)
    
    def test_get_fulfilment_summary_with_customer_filter(self):
        """Test getting fulfilment summary for a specific customer."""
        summary = self.report_repo.get_fulfilment_summary(customer_id=101)
        
        expected = {
            "pending": 2,
            "complete": 1
        }
        
        self.assertEqual(summary, expected)
    
    def test_get_customer_fulfilment_details(self):
        """Test getting detailed fulfilment information for a customer."""
        details = self.report_repo.get_customer_fulfilment_details(101)
        
        self.assertEqual(len(details), 3)
        
        # Check structure of details
        for detail in details:
            self.assertIn("order_id", detail)
            self.assertIn("fulfilment_status", detail)
            self.assertIn("amount", detail)
            self.assertIn("created_at", detail)
    
    def test_find_orders_by_fulfilment_date_range(self):
        """Test finding orders by fulfilment status and date range."""
        # Adjust dates to match test data
        end_date = datetime.now()
        start_date = end_date - timedelta(days=1)
        
        orders = self.report_repo.find_orders_by_fulfilment_date_range(
            start_date, end_date, "pending"
        )
        
        # Should find 2 pending orders (customer 101 has 2 pending, customer 102 has 1)
        self.assertEqual(len(orders), 3)
        
        # Check structure
        for order_id, customer_id, amount in orders:
            self.assertIsInstance(order_id, int)
            self.assertIsInstance(customer_id, int)
            self.assertIsInstance(amount, Decimal)


if __name__ == "__main__":
    unittest.main()