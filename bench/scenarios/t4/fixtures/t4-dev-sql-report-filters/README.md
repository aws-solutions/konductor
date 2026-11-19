# Internal Reporting Service

A lightweight internal service for generating sales and customer reports from our SQLite database.

## Overview

This service provides RESTful endpoints to query and export customer and sales data. It's designed for internal use by the sales and support teams.

## Features

- Filter customers by name, status, and date range
- Paginated results with sorting
- CSV export functionality
- SQLite backend with demo data seeding
- Simple WSGI interface

## Development

```bash
# Run tests
python3 -m unittest discover tests

# Start development server
python3 src/server.py

# Seed demo database
python3 data/seed.py
```

## API Endpoints

- `GET /api/customers` - List customers with filters
- `GET /api/customers.csv` - Export customers as CSV
- `GET /api/sales` - List sales with filters
- `GET /api/sales.csv` - Export sales as CSV

## Database Schema

The service uses a SQLite database at `data/reports.db` with the following tables:

- `customers` - Customer information
- `sales` - Sales transactions
- `products` - Product catalog

## Deployment

The service is deployed as a WSGI application. Configuration is managed through environment variables:

- `DATABASE_PATH` - Path to SQLite database (default: `data/reports.db`)
- `SERVER_HOST` - Server host (default: `localhost`)
- `SERVER_PORT` - Server port (default: `8080`)