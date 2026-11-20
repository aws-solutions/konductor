# API Documentation

## Customers API

### GET /api/customers

List customers with optional filters.

#### Query Parameters

- `name` (optional): Filter by customer name (case-insensitive substring search)
- `status` (optional): Comma-separated list of status values to include
- `start_date` (optional): Filter by creation date (YYYY-MM-DD)
- `end_date` (optional): Filter by creation date (YYYY-MM-DD)
- `sort_by` (optional): Column to sort by (default: `name`)
- `sort_dir` (optional): Sort direction - `ASC` or `DESC` (default: `ASC`)
- `limit` (optional): Maximum number of results (default: 100, max: 1000)
- `offset` (optional): Number of results to skip (default: 0)

#### Response

```json
{
  "data": [
    {
      "id": 1,
      "name": "John Smith",
      "email": "john.smith@example.com",
      "status": "active",
      "created_at": "2023-01-15",
      "total_spent": 1250.50
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 100,
    "offset": 0,
    "has_more": false
  }
}
```

### GET /api/customers.csv

Export customers as CSV with the same filters as the JSON endpoint.

## Sales API

### GET /api/sales

List sales with optional filters.

#### Query Parameters

- `customer` (optional): Filter by customer name (case-insensitive substring search)
- `product` (optional): Comma-separated list of product IDs to include
- `start_date` (optional): Filter by sale date (YYYY-MM-DD)
- `end_date` (optional): Filter by sale date (YYYY-MM-DD)
- `min_amount` (optional): Minimum sale amount
- `max_amount` (optional): Maximum sale amount
- `sort_by` (optional): Column to sort by (default: `sale_date`)
- `sort_dir` (optional): Sort direction - `ASC` or `DESC` (default: `DESC`)
- `limit` (optional): Maximum number of results (default: 100, max: 1000)
- `offset` (optional): Number of results to skip (default: 0)

#### Response

```json
{
  "data": [
    {
      "id": 1,
      "customer_id": 1,
      "product_id": 1,
      "sale_date": "2023-03-15",
      "quantity": 2,
      "amount": 199.98,
      "status": "completed",
      "customer_name": "John Smith",
      "product_name": "Laptop Pro"
    }
  ],
  "pagination": {
    "total": 125,
    "limit": 100,
    "offset": 0,
    "has_more": true
  }
}
```

### GET /api/sales.csv

Export sales as CSV with the same filters as the JSON endpoint.

## Status Codes

- `200 OK`: Request successful
- `400 Bad Request`: Invalid parameters
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

## Rate Limiting

No rate limiting is currently implemented for internal use.

## Authentication

No authentication is required for internal network access.