# Forum API Documentation

## Overview

The Forum API provides endpoints for user management, posts, and file uploads.

## Authentication

Most endpoints require authentication via session cookies. Login endpoint sets a session cookie.

## User Endpoints

### Register User

**POST** `/api/users`

Creates a new user account.

Request body:
```json
{
  "email": "user@example.com",
  "username": "username",
  "password": "password123"
}
```

Response (201 Created):
```json
{
  "user_id": "user_001",
  "email": "user@example.com",
  "username": "username",
  "created_at": 1672531200.0
}
```

### Login

**POST** `/api/users/login`

Authenticates a user and sets a session cookie.

Request body:
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Response (200 OK):
```json
{
  "user_id": "user_001",
  "username": "username",
  "avatar_url": "/uploads/user@example.com/avatar.jpg"
}
```

Sets cookie: `session=user_001`

### Get Current User

**GET** `/api/users/me`

Returns information about the currently authenticated user.

Response (200 OK):
```json
{
  "user_id": "user_001",
  "email": "user@example.com",
  "username": "username",
  "avatar_url": "/uploads/user@example.com/avatar.jpg",
  "post_count": 42,
  "created_at": 1672531200.0
}
```

### Update User

**PUT** `/api/users/{user_id}`

Updates user information. Requires authentication as the same user.

Request body (partial updates allowed):
```json
{
  "username": "newname",
  "avatar_url": "/uploads/new-avatar.jpg"
}
```

Response (200 OK):
```json
{
  "user_id": "user_001",
  "username": "newname",
  "avatar_url": "/uploads/new-avatar.jpg",
  "updated": true
}
```

**Note:** When updating avatar URL, the old image file is automatically deleted from the upload directory. This ensures storage doesn't accumulate orphaned files.

### Upload Avatar

**POST** `/api/users/avatar`

Uploads a profile picture. Requires authentication.

Request:
- Content-Type: `multipart/form-data`
- File field: `avatar`
- Maximum file size: 2MB (2097152 bytes)
- Allowed types: JPEG, PNG, GIF

Response (200 OK):
```json
{
  "avatar_url": "/uploads/user@example.com/filename.jpg",
  "message": "Avatar uploaded successfully"
}
```

## Upload Limits

- Maximum file size: 2MB (configurable via `FORUM_MAX_UPLOAD_SIZE` environment variable)
- Allowed file types: `.jpg`, `.jpeg`, `.png`, `.gif`
- Allowed MIME types: `image/jpeg`, `image/png`, `image/gif`

## Error Responses

All errors return HTTP status codes with JSON bodies:

```json
{
  "error": "Error description",
  "code": 400
}
```

Common error codes:
- 400: Bad Request (invalid input)
- 401: Unauthorized (missing/invalid authentication)
- 403: Forbidden (insufficient permissions)
- 404: Not Found
- 409: Conflict (e.g., duplicate email)
- 413: Payload Too Large (file too big)
- 415: Unsupported Media Type (wrong file type)