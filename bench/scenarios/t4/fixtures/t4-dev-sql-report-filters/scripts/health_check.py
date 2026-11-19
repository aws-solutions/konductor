#!/usr/bin/env python3
"""Health check script for the reporting service."""
import sqlite3
import sys
import os


def check_database():
    """Check database connectivity and integrity."""
    db_path = os.getenv('DATABASE_PATH', 'data/reports.db')
    
    if not os.path.exists(db_path):
        print(f"ERROR: Database file not found: {db_path}")
        return False
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check required tables exist
        required_tables = ['customers', 'products', 'sales']
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        existing_tables = {row[0] for row in cursor.fetchall()}
        
        missing_tables = set(required_tables) - existing_tables
        if missing_tables:
            print(f"ERROR: Missing tables: {missing_tables}")
            return False
        
        # Check basic data exists
        for table in required_tables:
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            count = cursor.fetchone()[0]
            if count == 0:
                print(f"WARNING: Table '{table}' is empty")
        
        # Check integrity
        cursor.execute("PRAGMA integrity_check")
        integrity_result = cursor.fetchone()[0]
        if integrity_result != 'ok':
            print(f"ERROR: Database integrity check failed: {integrity_result}")
            return False
        
        conn.close()
        return True
        
    except sqlite3.Error as e:
        print(f"ERROR: Database error: {e}")
        return False


def main():
    """Main entry point."""
    print("Running health check for reporting service...")
    
    if check_database():
        print("Health check PASSED")
        return 0
    else:
        print("Health check FAILED")
        return 1


if __name__ == '__main__':
    sys.exit(main())