"""Example queries for the reporting service."""
from src import database

# Initialize database
db = database.Database()

print("Example 1: Get all active customers")
results, total = db.get_customers(status_filter=['active'])
print(f"Found {len(results)} active customers out of {total} total")

print("\nExample 2: Search for customers by name")
results, total = db.get_customers(name_filter='smith')
print(f"Found {len(results)} customers with 'smith' in name")

print("\nExample 3: Get customers created in 2023")
results, total = db.get_customers(
    start_date='2023-01-01',
    end_date='2023-12-31',
    sort_by='created_at',
    sort_dir='DESC'
)
print(f"Found {len(results)} customers created in 2023")

print("\nExample 4: Get sales with pagination")
results, total = db.get_sales(
    limit=10,
    offset=0,
    sort_by='amount',
    sort_dir='DESC'
)
print(f"Top 10 sales by amount (total: {total}):")
for sale in results[:3]:  # Show first 3
    print(f"  ${sale['amount']} - {sale['customer_name']}")

print("\nExample 5: CSV export")
csv_results = db.get_customers_csv(
    status_filter=['active', 'pending'],
    sort_by='total_spent',
    sort_dir='DESC'
)
print(f"Exported {len(csv_results)} customers for CSV")