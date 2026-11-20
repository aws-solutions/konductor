# Harbor HTTP client

Harbor is the small HTTP client shared by the catalog and billing services. It
uses Node's built-in HTTP modules and deliberately has no runtime dependencies.

## Use

```js
const { request } = require('./src');

const response = await request('http://127.0.0.1:8080/health', {
  timeoutMs: 1500,
  retries: 1
});
console.log(response.statusCode, response.body);
```

A response contains `statusCode`, lower-case `headers`, `body`, `url`, and
`attempts`. GET responses can be retained briefly with `cacheTtlMs`. The
optional `logger` receives small event objects intended for structured logs.

## Options

- `method` - HTTP method (default: `'GET'`)
- `headers` - Request headers object
- `body` - Request body (string or Buffer)
- `timeoutMs` - Timeout per attempt in milliseconds (default: `1000`)
- `retries` - Number of additional attempts after the first (default: `0`)
- `retryOn` - Array of status codes to retry on (default: `[408, 425, 429, 500, 502, 503, 504]`)
- `retryDelayMs` - Delay between retries when no `Retry-After` header (default: `100`)
- `sleep` - Custom sleep function for retry delays
- `timers` - Custom `setTimeout`/`clearTimeout` implementation
- `cacheTtlMs` - Cache TTL for GET requests
- `logger` - Event logger function

## Retry Behavior

When `retries` is set, the client will automatically retry on transient error
status codes. The `Retry-After` response header is honored: numeric values are
interpreted as seconds, HTTP-date values as absolute timestamps. If absent or
invalid, `retryDelayMs` is used.

The `attempts` field in the response indicates the actual number of network
attempts made.

The package supports Node 24 and uses the built-in test runner.
