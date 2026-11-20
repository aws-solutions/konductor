# Forum Backend

A lightweight community forum backend built with Python 3.12 and standard library `http.server`.

## Features

- User registration and authentication
- Forum posts and threads
- Profile management
- Image upload support (profile pictures)
- RESTful API
- Built-in testing

## Quick Start

```bash
# Clone the repository
git clone https://github.com/example/forum-backend.git
cd forum-backend

# Run the server
python -m forum.server

# Run tests
python -m unittest discover -s tests
```

## Architecture

The project follows a modular structure:

- `src/forum/` - Core application modules
  - `server.py` - HTTP server implementation
  - `router.py` - URL routing
  - `handlers/` - Request handlers
  - `models/` - Data models
  - `storage/` - Data persistence
  - `utils/` - Utility functions

- `tests/` - Unit and integration tests
- `docs/` - Documentation
- `config/` - Configuration files

## Configuration

Environment variables:

- `FORUM_PORT` - Server port (default: 8080)
- `FORUM_HOST` - Server host (default: localhost)
- `FORUM_UPLOAD_DIR` - Upload directory for images (default: ./uploads)
- `FORUM_MAX_UPLOAD_SIZE` - Maximum upload size in bytes (default: 2MB)

## API Documentation

See `docs/api.md` for detailed API documentation.

## Development

```bash
# Run tests with coverage
python -m coverage run -m unittest discover -s tests
python -m coverage report

# Format code
python -m black src tests

# Lint code
python -m pylint src
```

## License

MIT