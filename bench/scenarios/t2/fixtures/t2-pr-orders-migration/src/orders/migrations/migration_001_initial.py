"""
Initial schema creation.
"""

def up(db):
    """Create initial tables."""
    db.execute("""
        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(20) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    db.execute("""
        CREATE INDEX idx_orders_customer ON orders(customer_id)
    """)
    
    db.execute("""
        CREATE INDEX idx_orders_status ON orders(status)
    """)
    
    db.execute("""
        CREATE TABLE order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )
    """)
    
    db.execute("""
        CREATE INDEX idx_order_items_order ON order_items(order_id)
    """)


def down(db):
    """Drop all tables."""
    db.execute("DROP TABLE IF EXISTS order_items")
    db.execute("DROP TABLE IF EXISTS orders")