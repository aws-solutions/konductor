# Deployment Guide

## Prerequisites

- Python 3.12 or later
- SQLite 3.35 or later

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/example/internal-reporting-service.git
   cd internal-reporting-service
   ```

2. No additional Python packages are required (standard library only).

3. Seed the database:
   ```bash
   python3 data/seed.py
   ```

## Configuration

Environment variables:

- `DATABASE_PATH`: Path to SQLite database file (default: `data/reports.db`)
- `SERVER_HOST`: Server hostname (default: `localhost`)
- `SERVER_PORT`: Server port (default: `8080`)
- `LOG_LEVEL`: Logging level (default: `INFO`)

## Running the Server

### Development

```bash
python3 src/server.py
```

The server will start on `http://localhost:8080`.

### Production

For production deployment, use a WSGI server like Gunicorn or uWSGI:

```bash
# Using gunicorn (if installed)
gunicorn src.server:run_server
```

Or integrate with your existing WSGI server configuration.

## Database Management

### Seeding

To create or recreate the demo database:

```bash
python3 data/seed.py --force
```

### Checking Database

To verify the database is properly seeded:

```bash
python3 data/seed.py --check
```

### Backup

Backup the SQLite database:

```bash
cp data/reports.db data/reports.db.backup
```

Or use SQLite's backup command:

```bash
sqlite3 data/reports.db ".backup data/reports.db.backup"
```

## Monitoring

### Logs

Check application logs for errors and usage patterns.

### Health Check

The service doesn't have a dedicated health check endpoint. Monitor by:
- Checking if the server is responding to requests
- Verifying database connectivity

## Troubleshooting

### Database Issues

If you encounter database errors:

1. Check file permissions:
   ```bash
   ls -la data/reports.db
   ```

2. Verify database integrity:
   ```bash
   sqlite3 data/reports.db "PRAGMA integrity_check;"
   ```

3. Recreate the database:
   ```bash
   python3 data/seed.py --force
   ```

### Server Issues

If the server fails to start:

1. Check port availability:
   ```bash
   netstat -tlnp | grep :8080
   ```

2. Verify Python version:
   ```bash
   python3 --version
   ```

3. Check for syntax errors:
   ```bash
   python3 -m py_compile src/*.py
   ```

## Scaling Considerations

This service is designed for internal use with moderate load. For higher traffic:

1. Consider using a more robust database (PostgreSQL, MySQL)
2. Implement connection pooling
3. Add caching for frequently accessed data
4. Consider load balancing for multiple instances