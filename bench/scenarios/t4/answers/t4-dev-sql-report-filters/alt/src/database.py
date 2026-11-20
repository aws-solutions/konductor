# Changes for this request; see the commit message for the reasoning.
"""Database access layer for the reporting service - SECURE VERSION."""
import sqlite3
import os
import re
from typing import List, Optional, Tuple, Dict, Any
import logging

logger = logging.getLogger(__name__)


def escape_like_wildcards(value: str) -> str:
    """Escape LIKE wildcards (% and _) in a string.
    
    Args:
        value: String to escape
        
    Returns:
        Escaped string with wildcards escaped
    """
    # Escape % and _ characters for LIKE queries
    # Use \ as escape character, so escape \ first
    value = value.replace('\\', '\\\\')
    value = value.replace('%', '\\%')
    value = value.replace('_', '\\_')
    return value


def validate_sort_column(column: str, allowed_columns: List[str]) -> str:
    """Validate sort column against allowed list.
    
    Args:
        column: Column name to validate
        allowed_columns: List of allowed column names
        
    Returns:
        Validated column name (defaults to first allowed column if invalid)
    
    Raises:
        ValueError: If column contains invalid characters or SQL injection attempt
    """
    # Check for SQL injection attempts
    if not column or not isinstance(column, str):
        raise ValueError("Invalid sort column")
    
    # Check for common SQL injection patterns
    sql_keywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'UNION', 'OR', 'AND', 'FROM', 'WHERE', 'JOIN']
    column_upper = column.upper()
    for keyword in sql_keywords:
        if keyword in column_upper:
            raise ValueError("Invalid sort column")
    
    # Check for special characters that could be used in SQL injection
    if any(c in column for c in [';', '--', '/*', '*/', "'", '"', '(', ')', ',']):
        raise ValueError("Invalid sort column")
    
    # Finally check if it's in the allowed list
    if column in allowed_columns:
        return column
    
    # Not in allowed list
    logger.warning(f"Invalid sort column: {column}, using default")
    return allowed_columns[0]


def validate_sort_direction(direction: str) -> str:
    """Validate sort direction.
    
    Args:
        direction: Sort direction to validate
        
    Returns:
        'ASC' or 'DESC' (defaults to 'ASC' if invalid)
    """
    direction = direction.upper()
    if direction in ('ASC', 'DESC'):
        return direction
    logger.warning(f"Invalid sort direction: {direction}, using ASC")
    return 'ASC'


def validate_limit_offset(limit: Optional[int], offset: Optional[int], max_limit: int = 1000) -> Tuple[int, int]:
    """Validate and sanitize limit and offset parameters.
    
    Args:
        limit: Maximum number of results
        offset: Number of results to skip
        max_limit: Maximum allowed limit
        
    Returns:
        Tuple of (validated_limit, validated_offset)
    """
    # Validate limit
    if limit is None or not isinstance(limit, int) or limit < 1:
        limit = 100
    limit = min(limit, max_limit)
    
    # Validate offset
    if offset is None or not isinstance(offset, int) or offset < 0:
        offset = 0
    
    return limit, offset


class Database:
    """Manages database connections and queries."""
    
    # Allowed sort columns for each table
    CUSTOMER_SORT_COLUMNS = ['id', 'name', 'email', 'status', 'created_at', 'total_spent']
    SALE_SORT_COLUMNS = ['id', 'customer_id', 'product_id', 'sale_date', 'quantity', 'amount', 'status']
    
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
            # Don't leak SQL details to client
            raise RuntimeError("Database error occurred")
    
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
        """Get customers with filters - SECURE VERSION.
        
        Args:
            name_filter: Customer name filter (LIKE pattern)
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
        # Validate and sanitize inputs
        try:
            sort_by = validate_sort_column(sort_by, self.CUSTOMER_SORT_COLUMNS)
        except ValueError:
            sort_by = "name"  # Use method default, not first allowed column
        sort_dir = validate_sort_direction(sort_dir)
        limit, offset = validate_limit_offset(limit, offset)
        
        # Build query with parameterized values
        query_parts = ["SELECT * FROM customers WHERE 1=1"]
        params = []
        
        if name_filter:
            # Escape LIKE wildcards and use parameterized query
            escaped_name = escape_like_wildcards(name_filter)
            query_parts.append("AND name LIKE ? ESCAPE '\\'")
            params.append(f"%{escaped_name}%")
        
        if status_filter:
            # Validate status values and use parameterized IN clause
            valid_statuses = {'active', 'inactive', 'pending', 'suspended'}
            filtered_statuses = [s for s in status_filter if s in valid_statuses]
            if filtered_statuses:
                placeholders = ', '.join(['?'] * len(filtered_statuses))
                query_parts.append(f"AND status IN ({placeholders})")
                params.extend(filtered_statuses)
            else:
                # All status values were invalid, return no results
                query_parts.append("AND 1=0")
        
        if start_date:
            # Validate date format (basic validation)
            if re.match(r'^\d{4}-\d{2}-\d{2}$', start_date):
                query_parts.append("AND created_at >= ?")
                params.append(start_date)
        
        if end_date:
            if re.match(r'^\d{4}-\d{2}-\d{2}$', end_date):
                query_parts.append("AND created_at <= ?")
                params.append(end_date)
        
        # Build count query
        count_query = "SELECT COUNT(*) as total FROM customers WHERE 1=1"
        if len(query_parts) > 1:
            count_query += " " + " ".join(query_parts[1:])
        
        # Build main query with sorting and pagination
        main_query = " ".join(query_parts)
        main_query += f" ORDER BY {sort_by} {sort_dir}"
        main_query += " LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Get total count
                cursor.execute(count_query, params[:-2])  # Exclude limit/offset params
                total = cursor.fetchone()[0]
                
                # Get paginated results
                cursor.execute(main_query, params)
                results = [dict(row) for row in cursor.fetchall()]
                
                return results, total
        except sqlite3.Error as e:
            logger.error(f"Error fetching customers: {e}")
            raise RuntimeError("Database error occurred")
    
    def get_customers_csv(
        self,
        name_filter: Optional[str] = None,
        status_filter: Optional[List[str]] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        sort_by: str = "name",
        sort_dir: str = "ASC"
    ) -> List[Dict[str, Any]]:
        """Get customers for CSV export - SECURE VERSION.
        
        Note: This uses the same secure pattern as get_customers.
        
        Args:
            name_filter: Customer name filter (LIKE pattern)
            status_filter: List of status values to include
            start_date: Start date for created_at filter (YYYY-MM-DD)
            end_date: End date for created_at filter (YYYY-MM-DD)
            sort_by: Column to sort by
            sort_dir: Sort direction (ASC or DESC)
            
        Returns:
            List of customer records
        """
        # Validate and sanitize inputs
        try:
            sort_by = validate_sort_column(sort_by, self.CUSTOMER_SORT_COLUMNS)
        except ValueError:
            sort_by = "name"  # Use method default
        sort_dir = validate_sort_direction(sort_dir)
        
        # Build query with parameterized values
        query_parts = ["SELECT id, name, email, status, created_at, total_spent FROM customers WHERE 1=1"]
        params = []
        
        if name_filter:
            escaped_name = escape_like_wildcards(name_filter)
            query_parts.append("AND name LIKE ? ESCAPE '\\'")
            params.append(f"%{escaped_name}%")
        
        if status_filter:
            valid_statuses = {'active', 'inactive', 'pending', 'suspended'}
            filtered_statuses = [s for s in status_filter if s in valid_statuses]
            if filtered_statuses:
                placeholders = ', '.join(['?'] * len(filtered_statuses))
                query_parts.append(f"AND status IN ({placeholders})")
                params.extend(filtered_statuses)
            else:
                # All status values were invalid, return no results
                query_parts.append("AND 1=0")
        
        if start_date:
            if re.match(r'^\d{4}-\d{2}-\d{2}$', start_date):
                query_parts.append("AND created_at >= ?")
                params.append(start_date)
        
        if end_date:
            if re.match(r'^\d{4}-\d{2}-\d{2}$', end_date):
                query_parts.append("AND created_at <= ?")
                params.append(end_date)
        
        query = " ".join(query_parts)
        query += f" ORDER BY {sort_by} {sort_dir}"
        
        return self.execute_query(query, tuple(params))
    
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
        """Get sales with filters - SECURE VERSION.
        
        Args:
            customer_name: Customer name filter (LIKE pattern)
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
        # Validate and sanitize inputs
        try:
            sort_by = validate_sort_column(sort_by, self.SALE_SORT_COLUMNS)
        except ValueError:
            sort_by = "sale_date"  # Use method default
        sort_dir = validate_sort_direction(sort_dir)
        limit, offset = validate_limit_offset(limit, offset)
        
        # Build query with parameterized values
        query = """
            SELECT s.*, c.name as customer_name, p.name as product_name
            FROM sales s
            JOIN customers c ON s.customer_id = c.id
            JOIN products p ON s.product_id = p.id
            WHERE 1=1
        """
        params = []
        
        if customer_name:
            escaped_name = escape_like_wildcards(customer_name)
            query += " AND c.name LIKE ? ESCAPE '\\'"
            params.append(f"%{escaped_name}%")
        
        if product_filter:
            # Validate product IDs are numeric
            numeric_ids = []
            for pid in product_filter:
                try:
                    if isinstance(pid, (int, float)) or (isinstance(pid, str) and pid.isdigit()):
                        numeric_ids.append(str(int(float(pid))))
                except (ValueError, TypeError):
                    continue
            
            if numeric_ids:
                placeholders = ', '.join(['?'] * len(numeric_ids))
                query += f" AND s.product_id IN ({placeholders})"
                params.extend(numeric_ids)
            else:
                # All product IDs were invalid, return no results
                query += " AND 1=0"
        
        if start_date:
            if re.match(r'^\d{4}-\d{2}-\d{2}$', start_date):
                query += " AND s.sale_date >= ?"
                params.append(start_date)
        
        if end_date:
            if re.match(r'^\d{4}-\d{2}-\d{2}$', end_date):
                query += " AND s.sale_date <= ?"
                params.append(end_date)
        
        if min_amount is not None:
            try:
                min_val = float(min_amount)
                query += " AND s.amount >= ?"
                params.append(min_val)
            except (ValueError, TypeError):
                pass
        
        if max_amount is not None:
            try:
                max_val = float(max_amount)
                query += " AND s.amount <= ?"
                params.append(max_val)
            except (ValueError, TypeError):
                pass
        
        # Count query
        count_query = f"SELECT COUNT(*) as total FROM ({query})"
        
        # Main query with sorting and pagination
        main_query = query + f" ORDER BY {sort_by} {sort_dir}"
        main_query += " LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Get total count
                cursor.execute(count_query, params[:-2])  # Exclude limit/offset params
                total = cursor.fetchone()[0]
                
                # Get paginated results
                cursor.execute(main_query, params)
                results = [dict(row) for row in cursor.fetchall()]
                
                return results, total
        except sqlite3.Error as e:
            logger.error(f"Error fetching sales: {e}")
            raise RuntimeError("Database error occurred")
    
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
        """Get sales for CSV export - SECURE VERSION.
        
        Args:
            customer_name: Customer name filter (LIKE pattern)
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
        # Validate and sanitize inputs
        try:
            sort_by = validate_sort_column(sort_by, self.SALE_SORT_COLUMNS)
        except ValueError:
            sort_by = "sale_date"  # Use method default
        sort_dir = validate_sort_direction(sort_dir)
        
        query = """
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
        params = []
        
        if customer_name:
            escaped_name = escape_like_wildcards(customer_name)
            query += " AND c.name LIKE ? ESCAPE '\\'"
            params.append(f"%{escaped_name}%")
        
        if product_filter:
            numeric_ids = []
            for pid in product_filter:
                try:
                    if isinstance(pid, (int, float)) or (isinstance(pid, str) and pid.isdigit()):
                        numeric_ids.append(str(int(float(pid))))
                except (ValueError, TypeError):
                    continue
            
            if numeric_ids:
                placeholders = ', '.join(['?'] * len(numeric_ids))
                query += f" AND p.id IN ({placeholders})"
                params.extend(numeric_ids)
            else:
                # All product IDs were invalid, return no results
                query += " AND 1=0"
        
        if start_date:
            if re.match(r'^\d{4}-\d{2}-\d{2}$', start_date):
                query += " AND s.sale_date >= ?"
                params.append(start_date)
        
        if end_date:
            if re.match(r'^\d{4}-\d{2}-\d{2}$', end_date):
                query += " AND s.sale_date <= ?"
                params.append(end_date)
        
        if min_amount is not None:
            try:
                min_val = float(min_amount)
                query += " AND s.amount >= ?"
                params.append(min_val)
            except (ValueError, TypeError):
                pass
        
        if max_amount is not None:
            try:
                max_val = float(max_amount)
                query += " AND s.amount <= ?"
                params.append(max_val)
            except (ValueError, TypeError):
                pass
        
        query += f" ORDER BY {sort_by} {sort_dir}"
        
        return self.execute_query(query, tuple(params))


# Global database instance
db = Database()