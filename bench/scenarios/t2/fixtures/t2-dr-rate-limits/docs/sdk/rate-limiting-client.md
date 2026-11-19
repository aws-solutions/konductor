# Rate Limiting Client SDK Documentation

## Overview

Our official SDKs provide built-in support for handling rate limiting responses. This document covers the expected behavior and integration points.

## HTTP Response Codes

### 429 Too Many Requests

When a client exceeds their rate limit, they will receive:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1617235200

{
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded. Try again in 60 seconds.",
  "retry_after": 60
}
```

### Headers

| Header | Description | Example |
|--------|-------------|---------|
| `Retry-After` | **Required**. Seconds to wait before retrying | `60` |
| `X-RateLimit-Limit` | Total requests allowed in window | `1000` |
| `X-RateLimit-Remaining` | Requests remaining in window | `0` |
| `X-RateLimit-Reset` | Unix timestamp when window resets | `1617235200` |

## Client Implementation Requirements

### Exponential Backoff

Clients **MUST** implement exponential backoff when receiving 429 responses:

```python
def make_request_with_backoff():
    base_delay = 1  # seconds
    max_delay = 60  # seconds
    max_retries = 5
    
    for attempt in range(max_retries):
        try:
            return make_request()
        except RateLimitExceeded as e:
            if attempt == max_retries - 1:
                raise
            
            # Use Retry-After header if provided, otherwise exponential backoff
            delay = e.retry_after if e.retry_after else min(base_delay * (2 ** attempt), max_delay)
            time.sleep(delay)
```

### Header Parsing

Clients should:
1. Always check for `Retry-After` header (seconds or HTTP-date)
2. Respect the provided wait time
3. Update internal rate limit counters based on response headers
4. Implement jitter (±10%) to avoid thundering herd

## SDK Implementations

### Python SDK

```python
from apiclient import Client

client = Client(api_key="your_key")

# Automatic rate limit handling
response = client.get("/users")

# Manual control
try:
    response = client.get("/users", handle_rate_limit=False)
except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after} seconds")
```

### JavaScript SDK

```javascript
import { APIClient } from '@ourcompany/sdk';

const client = new APIClient({ apiKey: 'your-key' });

// Automatic retry with backoff
const users = await client.get('/users');

// Manual handling
try {
  const users = await client.get('/users', { retryOnRateLimit: false });
} catch (error) {
  if (error.code === 'RATE_LIMIT_EXCEEDED') {
    const retryAfter = error.retryAfter; // in seconds
    await sleep(retryAfter * 1000);
  }
}
```

## Best Practices

### 1. Always Implement Backoff
Without proper backoff, clients can enter infinite retry loops that worsen rate limiting issues.

### 2. Respect Retry-After
The server knows the exact window boundaries. Always use the provided `Retry-After` value over client-side calculations.

### 3. Monitor Rate Limit Usage
Track `X-RateLimit-Remaining` headers to proactively slow down before hitting limits.

### 4. Implement Circuit Breakers
If consistently hitting rate limits, implement circuit breakers to fail fast and notify users.

### 5. Cache Responses
Cache frequently accessed data to reduce API calls.

## Testing

### Mock Server
Test rate limiting behavior using our mock server:

```bash
docker run -p 8080:8080 ourcompany/mock-api --rate-limit=10
```

### Integration Tests
```python
def test_rate_limiting():
    # Exhaust rate limit
    for _ in range(11):
        response = client.get("/test")
        if response.status_code == 429:
            assert "Retry-After" in response.headers
            break
```

## Troubleshooting

### Common Issues

1. **Missing Retry-After header**: Check server version and configuration
2. **Inconsistent limits**: Ensure API key is being passed correctly
3. **Sudden rate limiting**: Check for credential sharing or sudden traffic spikes
4. **Backoff not working**: Verify exponential backoff implementation

### Debug Headers
For debugging, include `X-Debug-RateLimit: true` in requests to get additional information in response headers.

## Version History

| Version | Changes | Date |
|---------|---------|------|
| v1.0 | Initial release | 2023-11-01 |
| v1.1 | Added Retry-After requirement | 2024-01-15 |
| v1.2 | Added X-RateLimit-* headers | 2024-02-28 |

## Support

For issues with rate limiting:
1. Check this documentation
2. Review SDK source code
3. Contact support@ourcompany.com
4. Open GitHub issue for SDK bugs