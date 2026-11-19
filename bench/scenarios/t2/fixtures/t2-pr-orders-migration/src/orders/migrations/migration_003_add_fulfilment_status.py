"""
Add fulfilment status column and backfill data.
"""

def up(db):
    """Add fulfilment_status column and backfill."""
    # Add the column with default value for existing rows
    db.execute("""
        ALTER TABLE orders
        ADD COLUMN fulfilment_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    """)
    
    # Update fulfilment status based on order status
    db.execute("""
        UPDATE orders
        SET fulfilment_status = CASE
            WHEN status = 'shipped' THEN 'complete'
            WHEN status = 'cancelled' THEN 'cancelled'
            ELSE 'pending'
        END
    """)
    
    # Create index for reporting queries
    db.execute("""
        CREATE INDEX idx_orders_fulfilment ON orders(fulfilment_status)
    """)


def down(db):
    """Remove fulfilment_status column."""
    db.execute("PRAGMA foreign_keys = OFF")
    
    # Create new table without fulfilment_status
    db.execute("""
        CREATE TABLE orders_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) NOT NULL,
            notes TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Copy data (excluding fulfilment_status)
    db.execute("""
        INSERT INTO orders_new (id, customer_id, amount, status, notes, created_at, updated_at)
        SELECT id, customer_id, amount, status, notes, created_at, updated_at
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