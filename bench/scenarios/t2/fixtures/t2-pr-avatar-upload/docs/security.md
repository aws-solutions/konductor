# Security Guidelines

## File Upload Security

### Path Traversal Prevention

All user-uploaded files are sanitized to prevent path traversal attacks. The system:
1. Replaces `/` and `\` characters with underscores in filenames
2. Stores files only within the designated upload directory
3. Validates file paths before serving

### File Type Validation

Uploaded images are validated using multiple methods:
1. Content-Type header check
2. File extension validation
3. Actual file content inspection using Python's `imghdr`

### Size Limits

- Maximum upload size: 2MB (configurable)
- Files exceeding this limit are rejected with HTTP 413

### Storage Cleanup

Old avatar files are automatically deleted when users upload new ones. This prevents accumulation of unused files.

## Authentication

### Session Management

- Sessions use HTTP-only cookies
- Session timeout: 1 hour (configurable)
- No sensitive data stored in cookies

### Password Security

- Passwords are hashed using SHA-256
- No plaintext password storage
- Minimum password length: 8 characters

## Data Validation

### Input Validation

All user inputs are validated:
- Email format validation
- Username length and character restrictions
- JSON schema validation for API requests

### Output Encoding

All dynamic content in responses is properly encoded to prevent XSS attacks.

## Configuration Security

### Environment Variables

Sensitive configuration uses environment variables:
- Server port and host
- File upload directory
- Maximum upload size
- Logging configuration

### Default Security

The application ships with secure defaults:
- Localhost-only binding by default
- Reasonable size limits
- Strict file type validation

## Deployment Considerations

### File Permissions

Ensure upload directory has proper permissions:
- Writeable by server process
- Not executable
- Not accessible via directory listing

### Reverse Proxy

When deploying behind a reverse proxy:
- Set appropriate request size limits
- Configure timeout values
- Enable HTTPS termination

### Monitoring

Monitor for:
- Failed login attempts
- File upload errors
- Unusual request patterns
- Storage usage

## Regular Maintenance

1. Review and rotate session secrets periodically
2. Monitor and update dependencies
3. Review access logs for suspicious activity
4. Regularly clean up old/temporary files