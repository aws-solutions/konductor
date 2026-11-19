"""
Repository for order reporting operations.
"""

import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from .database import Database


class OrderReportRepository:
    """Repository for order reporting."""
    
    def __init__(self, db: Database):
        self.db = db
    
    def get_fulfilment_summary(self, customer_id: Optional[int] = None) -> Dict[str, int]:
        """Get summary of fulfilment statuses."""
        query = "SELECT fulfilment_status, COUNT(*) FROM orders"
        params = ()
        
        if customer_id:
            query += f" WHERE customer_id = {customer_id}"
        
        query += " GROUP BY fulfilment_status"
        
        cursor = self.db.execute(query, params)
        
        summary = {}
        for row in cursor.fetchall():
            summary[row[0]] = row[1]
        
        return summary
    
    def get_customer_fulfilment_details(self, customer_id: int) -> List[Dict]:
        """Get detailed fulfilment information for a customer."""
        # First get customer's orders
        cursor = self.db.execute("""
            SELECT id, fulfilment_status
            FROM orders
            WHERE customer_id = ?
        """, (customer_id,))
        
        orders = cursor.fetchall()
        
        details = []
        for order_id, fulfilment_status in orders:
            # Get additional details for each order
            detail_cursor = self.db.execute("""
                SELECT amount, created_at
                FROM orders
                WHERE id = ?
            """, (order_id,))
            
            amount, created_at = detail_cursor.fetchone()
            
            details.append({
                "order_id": order_id,
                "fulfilment_status": fulfilment_status,
                "amount": Decimal(str(amount)),
                "created_at": datetime.datetime.fromisoformat(created_at) if created_at else None
            })
        
        return details
    
    def find_orders_by_fulfilment_date_range(
        self, 
        start_date: datetime.datetime, 
        end_date: datetime.datetime,
        fulfilment_status: str
    ) -> List[Tuple[int, int, Decimal]]:
        """Find orders by fulfilment status within a date range."""
        cursor = self.db.execute("""
            SELECT id, customer_id, amount
            FROM orders
            WHERE created_at BETWEEN ? AND ?
            AND fulfilment_status = ?
            ORDER BY created_at DESC
        """, (
            start_date.isoformat(),
            end_date.isoformat(),
            fulfilment_status
        ))
        
        return [(row[0], row[1], Decimal(str(row[2]))) for row in cursor.fetchall()]