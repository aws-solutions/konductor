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

The package supports Node 24 and uses the built-in test runner.
