"""
Add notes column to orders.
"""

def up(db):
    """Add notes column."""
    db.execute("""
        ALTER TABLE orders
        ADD COLUMN notes TEXT
    """)


def down(db):
    """Remove notes column."""
    # SQLite doesn't support DROP COLUMN directly
    # We need to recreate the table without the column
    db.execute("PRAGMA foreign_keys = OFF")
    
    # Create new table without notes
    db.execute("""
        CREATE TABLE orders_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Copy data
    db.execute("""
        INSERT INTO orders_new (id, customer_id, amount, status, created_at, updated_at)
        SELECT id, customer_id, amount, status, created_at, updated_at
        FROM orders
    """)
    
    # Drop old table and rename new one
    db.execute("DROP TABLE orders")
    db.execute("ALTER TABLE orders_new RENAME TO orders")
    
    # Recreate indexes
    db.execute("""
        CREATE INDEX idx_orders_customer ON orders(customer_id)
    """)
    
    db.execute("""
        CREATE INDEX idx_orders_status ON orders(status)
    """)
    
    db.execute("PRAGMA foreign_keys = ON")