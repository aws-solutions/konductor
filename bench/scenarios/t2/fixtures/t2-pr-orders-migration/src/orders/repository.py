"""
Order repository for data access.
"""

import datetime
from dataclasses import dataclass
from decimal import Decimal
from typing import List, Optional, Tuple

from .database import Database


@dataclass
class Order:
    """Order entity."""
    id: Optional[int] = None
    customer_id: int = 0
    amount: Decimal = Decimal("0.00")
    status: str = "pending"
    notes: Optional[str] = None
    created_at: Optional[datetime.datetime] = None
    updated_at: Optional[datetime.datetime] = None


class OrderRepository:
    """Repository for order operations."""
    
    def __init__(self, db: Database):
        self.db = db
    
    def create(self, order: Order) -> Order:
        """Create a new order."""
        cursor = self.db.execute("""
            INSERT INTO orders (customer_id, amount, status, notes)
            VALUES (?, ?, ?, ?)
        """, (order.customer_id, str(order.amount), order.status, order.notes))
        
        order.id = cursor.lastrowid
        self.db.commit()
        return order
    
    def find_by_id(self, order_id: int) -> Optional[Order]:
        """Find an order by ID."""
        cursor = self.db.execute("""
            SELECT id, customer_id, amount, status, notes, created_at, updated_at
            FROM orders
            WHERE id = ?
        """, (order_id,))
        
        row = cursor.fetchone()
        if not row:
            return None
        
        return Order(
            id=row[0],
            customer_id=row[1],
            amount=Decimal(str(row[2])),
            status=row[3],
            notes=row[4],
            created_at=datetime.datetime.fromisoformat(row[5]) if row[5] else None,
            updated_at=datetime.datetime.fromisoformat(row[6]) if row[6] else None
        )
    
    def update_status(self, order_id: int, status: str) -> bool:
        """Update order status."""
        cursor = self.db.execute("""
            UPDATE orders
            SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (status, order_id))
        
        self.db.commit()
        return cursor.rowcount > 0
    
    def find_by_customer(self, customer_id: int, limit: int = 100) -> List[Order]:
        """Find orders for a customer."""
        cursor = self.db.execute("""
            SELECT id, customer_id, amount, status, notes, created_at, updated_at
            FROM orders
            WHERE customer_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        """, (customer_id, limit))
        
        orders = []
        for row in cursor.fetchall():
            orders.append(Order(
                id=row[0],
                customer_id=row[1],
                amount=Decimal(str(row[2])),
                status=row[3],
                notes=row[4],
                created_at=datetime.datetime.fromisoformat(row[5]) if row[5] else None,
                updated_at=datetime.datetime.fromisoformat(row[6]) if row[6] else None
            ))
        
        return orders
    
    def count_by_status(self, status: str) -> int:
        """Count orders with a specific status."""
        cursor = self.db.execute("""
            SELECT COUNT(*) FROM orders WHERE status = ?
        """, (status,))
        
        return cursor.fetchone()[0]