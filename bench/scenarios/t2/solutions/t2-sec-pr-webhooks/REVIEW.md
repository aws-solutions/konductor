# Security Review: Generic Webhook Handler

This PR adds a generic webhook handler to support custom providers. While the feature is useful, several security issues need to be addressed before merging. The most critical problems involve signature verification flaws and missing replay protection that could allow attackers to forge or replay webhooks.

## Critical Findings

### 1. Missing Replay Attack Protection (Critical)
**Location**: `src/handlers/generic.js:46-63`
The generic handler has no replay protection: delivery IDs are stored forever (no TTL cleanup) and the `X-Timestamp` header is read but never validated. This allows unlimited replay attacks, violating documented requirements for 5-10 minute windows in `docs/security.md` and `docs/provider-spec.md`.

**Fix**: Implement timestamp validation (reject if older than 5 minutes) and add TTL to delivery ID storage using `DELIVERY_ID_WINDOW_MS` from `security.js`.

### 2. Unvalidated Callback URL SSRF (Critical)
**Location**: `src/handlers/notify.js:25-26`
The new `/notify` endpoint forwards to ANY customer-provided URL without validation, enabling SSRF attacks to internal networks (10.x, 172.16-31.x, 192.168.x), localhost, and cloud metadata endpoints (169.254.169.254).

**Fix**: Apply the same URL validation as `notifyCallback()` or restrict to public HTTPS endpoints with domain allowlists.

### 3. Signature Uses Parsed JSON (High)
**Location**: `src/handlers/generic.js:30-35`
The `verifyWebhookSignature` function computes HMAC over `JSON.stringify(parsedBody)` instead of the raw request body. Different JSON serializations (duplicate keys, number formatting, whitespace) will produce different hashes, allowing malicious payloads to pass or causing legitimate deliveries to fail.

**Fix**: Use the raw request body (`req.rawBody`) that Express middleware stores, matching what the client signed.

### 4. Hard-coded Secret Fallback (High)
**Location**: `src/config/env.js:8`
The `WEBHOOK_SECRET` configuration falls back to `'dev_default_secret_123'` when the environment variable is missing. In production, this would mean all deployments share the same weak secret by default, making signature verification useless.

**Fix**: Require the secret in production (throw an error if missing) or generate a secure random secret at startup.

## Medium Severity

### 5. Timing Attack in Signature Comparison (Medium)
**Location**: `src/handlers/generic.js:38`
Signature comparison uses `===` which leaks timing information about the match. An attacker could use this to slowly discover the expected signature byte by byte.

**Fix**: Use `crypto.timingSafeEqual()` like the GitHub and Stripe handlers do.

### 6. Secret Leaked in Debug Logs (Medium)
**Location**: `src/handlers/generic.js:120-124`
The debug log prints the signature header (truncated, but still sensitive). If `LOG_LEVEL=debug` is enabled in production, HMAC signatures could appear in logs.

**Fix**: Never log signature headers, or redact them completely in log messages.

### 7. Secret-Bearing Header in Error Logs (Medium)
**Location**: `src/handlers/generic.js:24`
The error log prints the full signature header when verification fails, exposing the secret-bearing HMAC in error logs that are often collected in production.

**Fix**: Redact or omit signature from all logs, including error logs.

## Overall Verdict

**Block merging** until items 1-4 are fixed. The signature verification flaws fundamentally break webhook security, and the missing replay protection violates documented requirements.

The code structure is good and tests exist, but security implementation needs significant work. Pay special attention to cross-file consistency: the new generic handler should match the security patterns already established in the GitHub and Stripe handlers (raw body, timing-safe compare, time windows).

```json
[
  {
    "location": "src/handlers/generic.js:30",
    "severity": "high",
    "issue": "Signature verification uses re-serialized parsed JSON instead of the raw request body, so a body with duplicate keys or different number formatting can pass signature check, and legitimate deliveries with valid signatures can fail.",
    "fix": "Use raw request body (req.rawBody) not JSON.stringify(parsedBody)"
  },
  {
    "location": "src/handlers/generic.js:38",
    "severity": "medium",
    "issue": "Signature comparison uses plain string equality (===) which is vulnerable to timing attacks that could leak the expected signature.",
    "fix": "Use crypto.timingSafeEqual() like the GitHub and Stripe handlers"
  },
  {
    "location": "src/handlers/generic.js:46",
    "severity": "critical",
    "issue": "Missing replay attack protection: delivery IDs have no expiration (stored forever) and X-Timestamp header is read but never validated, allowing unlimited replay attacks contrary to docs requirements for 5-minute windows.",
    "fix": "Implement replay protection with timestamp validation and TTL cleanup"
  },
  {
    "location": "src/handlers/notify.js:25",
    "severity": "critical",
    "issue": "The /notify endpoint forwards to ANY customer-provided URL without validation, allowing SSRF attacks to internal networks (10.x, 172.16-31.x, 192.168.x) and cloud metadata endpoints (169.254.169.254).",
    "fix": "Validate URLs to restrict to public endpoints or use allowlists"
  },
  {
    "location": "src/config/env.js:8",
    "severity": "high",
    "issue": "WEBHOOK_SECRET falls back to a hard-coded default when the environment variable is missing, which would use the same weak secret in production if misconfigured.",
    "fix": "WEBHOOK_SECRET should be required (no default) in production"
  },
  {
    "location": "src/handlers/generic.js:120",
    "severity": "medium",
    "issue": "The debug log prints the signature header which contains the HMAC, potentially leaking it in logs if LOG_LEVEL=debug is enabled in production.",
    "fix": "Remove or redact signature from debug logs"
  },
  {
    "location": "src/handlers/generic.js:24",
    "severity": "medium",
    "issue": "Error log prints the full signature header when verification fails, exposing the secret-bearing HMAC in error logs.",
    "fix": "Do not log signature headers in error messages"
  }
]
```