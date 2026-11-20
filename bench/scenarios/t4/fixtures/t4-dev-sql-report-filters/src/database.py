"""Database access layer for the reporting service."""
import sqlite3
import os
from typing import List, Optional, Tuple, Dict, Any
import logging

logger = logging.getLogger(__name__)


class Database:
    """Manages database connections and queries."""
    
    def __init__(self, db_path: str = "data/reports.db"):
        """Initialize database connection.
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = db_path
        self._ensure_db_directory()
    
    def _ensure_db_directory(self):
        """Ensure the database directory exists."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
    
    def get_connection(self) -> sqlite3.Connection:
        """Get a database connection."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def execute_query(self, query: str, params: tuple = ()) -> List[Dict[str, Any]]:
        """Execute a query and return results as dictionaries.
        
        Args:
            query: SQL query string
            params: Query parameters
            
        Returns:
            List of result rows as dictionaries
        """
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, params)
                results = [dict(row) for row in cursor.fetchall()]
                return results
        except sqlite3.Error as e:
            logger.error(f"Database error: {e}")
            raise
    
    def get_customers(
        self,
        name_filter: Optional[str] = None,
        status_filter: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        sort_by: str = "name",
        sort_dir: str = "ASC",
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Get customers with filters.
        
        Args:
            name_filter: Customer name filter (substring)
            status_filter: List of status values to include
            start_date: Start date for created_at filter (YYYY-MM-DD)
            end_date: End date for created_at filter (YYYY-MM-DD)
            sort_by: Column to sort by
            sort_dir: Sort direction (ASC or DESC)
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (results list, total count)
        """
        query_parts = ["SELECT * FROM customers WHERE 1=1"]
        params = []
        
        if name_filter:
            query_parts.append(f"AND name LIKE '%{name_filter}%'")
        
        if status_filter:
            status_list = ", ".join(f"'{status}'" for status in status_filter)
            query_parts.append(f"AND status IN ({status_list})")
        
        if start_date:
            query_parts.append(f"AND created_at >= '{start_date}'")
        
        if end_date:
            query_parts.append(f"AND created_at <= '{end_date}'")
        
        # Build count query
        count_query = "SELECT COUNT(*) as total FROM customers WHERE 1=1"
        if len(query_parts) > 1:
            count_query += " " + " ".join(query_parts[1:])  # Skip the initial SELECT
        
        # Build main query with sorting and pagination
        main_query = " ".join(query_parts)
        main_query += f" ORDER BY {sort_by} {sort_dir}"
        main_query += f" LIMIT {limit} OFFSET {offset}"
        
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Get total count
                cursor.execute(count_query)
                total = cursor.fetchone()[0]
                
                # Get paginated results
                cursor.execute(main_query)
                results = [dict(row) for row in cursor.fetchall()]
                
                return results, total
        except sqlite3.Error as e:
            logger.error(f"Error fetching customers: {e}")
            raise
    
    def get_customers_csv(
        self,
        name_filter: Optional[str] = None,
        status_filter: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        sort_by: str = "name",
        sort_dir: str = "ASC"
    ) -> List[Dict[str, Any]]:
        """Get customers for CSV export.
        
        Args:
            name_filter: Customer name filter (substring)
            status_filter: List of status values to include
            start_date: Start date for created_at filter (YYYY-MM-DD)
            end_date: End date for created_at filter (YYYY-MM-DD)
            sort_by: Column to sort by
            sort_dir: Sort direction (ASC or DESC)
            
        Returns:
            List of customer records
        """
        base_query = "SELECT id, name, email, status, created_at, total_spent FROM customers"
        where_clauses = []
        
        if name_filter:
            where_clauses.append(f"name LIKE '%{name_filter}%'")
        
        if status_filter:
            status_str = "','".join(status_filter)
            where_clauses.append(f"status IN ('{status_str}')")
        
        if start_date:
            where_clauses.append(f"created_at >= '{start_date}'")
        
        if end_date:
            where_clauses.append(f"created_at <= '{end_date}'")
        
        if where_clauses:
            base_query += " WHERE " + " AND ".join(where_clauses)
        
        base_query += f" ORDER BY {sort_by} {sort_dir}"
        
        return self.execute_query(base_query)
    
    def get_sales(
        self,
        customer_name: Optional[str] = None,
        product_filter: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        min_amount: Optional[float] = None,
        max_amount: Optional[float] = None,
        sort_by: str = "sale_date",
        sort_dir: str = "DESC",
        limit: int = 100,
        offset: int = 0
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Get sales with filters.
        
        Args:
            customer_name: Customer name filter (substring)
            product_filter: List of product IDs to include
            start_date: Start date for sale_date filter (YYYY-MM-DD)
            end_date: End date for sale_date filter (YYYY-MM-DD)
            min_amount: Minimum sale amount
            max_amount: Maximum sale amount
            sort_by: Column to sort by
            sort_dir: Sort direction (ASC or DESC)
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (results list, total count)
        """
        query = """
            SELECT s.*, c.name as customer_name, p.name as product_name
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            JOIN products p ON s.product_id = p.id
            WHERE 1=1
        """
        params = []
        
        if customer_name:
            query += f" AND c.name LIKE '%{customer_name}%'"
        
        if product_filter:
            product_ids = ", ".join(str(pid) for pid in product_filter)
            query += f" AND s.product_id IN ({product_ids})"
        
        if start_date:
            query += f" AND s.sale_date >= '{start_date}'"
        
        if end_date:
            query += f" AND s.sale_date <= '{end_date}'"
        
        if min_amount is not None:
            query += f" AND s.amount >= {min_amount}"
        
        if max_amount is not None:
            query += f" AND s.amount <= {max_amount}"
        
        # Count query
        count_query = f"SELECT COUNT(*) as total FROM ({query})"
        
        # Main query with sorting and pagination
        main_query = query + f" ORDER BY {sort_by} {sort_dir}"
        main_query += f" LIMIT {limit} OFFSET {offset}"
        
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Get total count
                cursor.execute(count_query)
                total = cursor.fetchone()[0]
                
                # Get paginated results
                cursor.execute(main_query)
                results = [dict(row) for row in cursor.fetchall()]
                
                return results, total
        except sqlite3.Error as e:
            logger.error(f"Error fetching sales: {e}")
            raise
    
    def get_sales_csv(
        self,
        customer_name: Optional[str] = None,
        product_filter: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        min_amount: Optional[float] = None,
        max_amount: Optional[float] = None,
        sort_by: str = "sale_date",
        sort_dir: str = "DESC"
    ) -> List[Dict[str, Any]]:
        """Get sales for CSV export.
        
        Args:
            customer_name: Customer name filter (substring)
            product_filter: List of product IDs to include
            start_date: Start date for sale_date filter (YYYY-MM-DD)
            end_date: End date for sale_date filter (YYYY-MM-DD)
            min_amount: Minimum sale amount
            max_amount: Maximum sale amount
            sort_by: Column to sort by
            sort_dir: Sort direction (ASC or DESC)
            
        Returns:
            List of sales records
        """
        query = f"""
            SELECT 
                s.id,
                s.sale_date,
                c.name as customer,
                p.name as product,
                s.quantity,
                s.amount,
                s.status
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            JOIN products p ON s.product_id = p.id
            WHERE 1=1
        """
        
        if customer_name:
            query += f" AND c.name LIKE '%{customer_name}%'"
        
        if product_filter:
            product_str = "','".join(product_filter)
            query += f" AND p.id IN ('{product_str}')"
        
        if start_date:
            query += f" AND s.sale_date >= '{start_date}'"
        
        if end_date:
            query += f" AND s.sale_date <= '{end_date}'"
        
        if min_amount is not None:
            query += f" AND s.amount >= {min_amount}"
        
        if max_amount is not None:
            query += f" AND s.amount <= {max_amount}"
        
        query += f" ORDER BY {sort_by} {sort_dir}"
        
        return self.execute_query(query)


# Global database instance
db = Database()