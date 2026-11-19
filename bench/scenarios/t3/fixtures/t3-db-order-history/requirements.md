# Order History Database - Requirements

## Overview
ShopFast, a growing e-commerce platform, needs to design a new order history database to replace their legacy system. The new system must support query patterns for the customer-facing application, warehouse operations, and financial reporting.

## Data Volume
- **Current order lines**: Approximately 900 million records
- **Growth rate**: 3 million new order lines per day
- **Retention policy**: 3 years of history required

## Query Patterns

### Customer Application
1. Show customer's recent orders (newest first)
2. Look up specific order by order number
3. View all items in a specific order

### Warehouse Operations
4. List open orders by warehouse for fulfillment
5. Check order status by order number

### Financial Reporting
6. Generate sales reports by date range (daily, weekly, monthly)
7. Calculate revenue by product category for tax reporting

## Performance Requirements
- **P99 read latency**: < 100ms for customer-facing queries
- **Throughput**: 500 MB/s sustained read throughput for reporting jobs
- **IOPS**: 15,000 read IOPS for concurrent user queries

## Data Characteristics
Each order line record contains:
- Order metadata (customer, date, status, warehouse)
- Product details (SKU, category, price)
- Line item details (quantity, discounts, taxes)
- Shipping information
- Payment details

Average row size is approximately 2.5 KB when stored with minimal indexing overhead.

## Constraints
- Database must use SQLite for operational simplicity and cost
- All data must reside on attached storage volumes
- Storage budget: $300/month maximum for storage costs
- **Storage capacity limit**: 2.5 TB on Standard volume class
- RPO (Recovery Point Objective): 5 minutes
- RTO (Recovery Time Objective): 15 minutes for critical queries

## Integration Points
- Real-time sync from transactional database (PostgreSQL)
- Batch exports to data warehouse (nightly)
- API access for customer service tools