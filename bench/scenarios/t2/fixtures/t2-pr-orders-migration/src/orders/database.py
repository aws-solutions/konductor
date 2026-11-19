"""
Database connection management.
"""

import sqlite3
from typing import Optional


class Database:
    """SQLite database connection wrapper."""
    
    def __init__(self, path: str = "orders.db"):
        self.path = path
        self._connection: Optional[sqlite3.Connection] = None
    
    def connect(self) -> sqlite3.Connection:
        """Get a database connection."""
        if self._connection is None:
            self._connection = sqlite3.connect(self.path)
            # Enable foreign keys
            self._connection.execute("PRAGMA foreign_keys = ON")
            # Better performance for writes
            self._connection.execute("PRAGMA journal_mode = WAL")
        return self._connection
    
    def disconnect(self):
        """Close the database connection."""
        if self._connection:
            self._connection.close()
            self._connection = None
    
    def execute(self, query: str, params: tuple = ()) -> sqlite3.Cursor:
        """Execute a query with parameters."""
        conn = self.connect()
        return conn.execute(query, params)
    
    def executemany(self, query: str, params_list: list[tuple]) -> sqlite3.Cursor:
        """Execute a query multiple times with different parameters."""
        conn = self.connect()
        return conn.executemany(query, params_list)
    
    def commit(self):
        """Commit the current transaction."""
        if self._connection:
            self._connection.commit()
    
    def rollback(self):
        """Rollback the current transaction."""
        if self._connection:
            self._connection.rollback()