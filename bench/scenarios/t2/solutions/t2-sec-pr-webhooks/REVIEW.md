# Security Review: Generic Webhook Handler

This PR adds a generic webhook handler to support custom providers. While the feature is useful, several security issues need to be addressed before merging. The most critical problems involve signature verification flaws and missing replay protection that could allow attackers to forge or replay webhooks.

## Critical Findings

### 1. Missing Timestamp Validation (Critical)
**Location**: `src/handlers/generic.js:100-115`
The handler reads the `X-Timestamp` header but never validates it against the current time. According to `docs/provider-spec.md`, generic webhooks must validate timestamps within 5 minutes when present. Without this check, attackers can replay old webhooks indefinitely.

**Fix**: Parse the timestamp header and reject if older than 5 minutes (or use `MAX_TIMESTAMP_AGE_MS` from `security.js`).

### 2. Hard-coded Secret Fallback (High)
**Location**: `src/config/env.js:8`
The `WEBHOOK_SECRET` configuration falls back to `'dev_default_secret_123'` when the environment variable is missing. In production, this would mean all deployments share the same weak secret by default, making signature verification useless.

**Fix**: Require the secret in production (throw an error if missing) or generate a secure random secret at startup.

### 3. Signature Uses Parsed JSON (High)
**Location**: `src/handlers/generic.js:30-35`
The `verifyWebhookSignature` function computes the HMAC over `JSON.stringify(parsedBody)` instead of the raw request body. Different JSON serializations (whitespace, key order) will produce different hashes, causing valid signatures to fail. The documentation explicitly states to use the "raw body".

**Fix**: Use the raw request body (`req.rawBody`) that Express middleware stores, matching what the client signed.

### 4. No Delivery ID Time Window (High)
**Location**: `src/handlers/generic.js:49-65`
Delivery IDs are stored in a Set with simple size-based cleanup but no expiration. The documentation requires a "configured window" for replay protection, and other handlers (GitHub: 10min, Stripe: 15min) implement time windows.

**Fix**: Store delivery IDs with timestamps and implement TTL cleanup using the `DELIVERY_ID_WINDOW_MS` constant from `security.js`.

## Medium Severity

### 5. Timing Attack in Signature Comparison (Medium)
**Location**: `src/handlers/generic.js:38`
Signature comparison uses `===` which leaks timing information about the match. An attacker could use this to slowly discover the expected signature byte by byte.

**Fix**: Use `crypto.timingSafeEqual()` like the GitHub and Stripe handlers do.

### 6. Secret Leaked in Debug Logs (Medium)
**Location**: `src/handlers/generic.js:120-124`
The debug log prints the signature header (truncated, but still sensitive). If `LOG_LEVEL=debug` is enabled in production, HMAC signatures could appear in logs.

**Fix**: Never log signature headers, or redact them completely in log messages.

## Low Severity

### 7. Configuration Status in Startup Log (Low)
**Location**: `src/index.js:36-39`
The startup log indicates whether the webhook secret is "configured" or "using default". This information could help an attacker know if the default secret is in use.

**Fix**: Don't log configuration status, or use a generic message.

## Overall Verdict

**Block merging** until items 1-4 are fixed. The signature verification flaws fundamentally break webhook security, and the missing replay protection violates documented requirements.

The code structure is good and tests exist, but security implementation needs significant work. Pay special attention to cross-file consistency: the new generic handler should match the security patterns already established in the GitHub and Stripe handlers (raw body, timing-safe compare, time windows).

```json
[
  {
    "location": "src/handlers/generic.js:30",
    "severity": "high",
    "issue": "Signature verification uses re-serialized parsed JSON instead of the raw request body, which can cause verification failures if the client signed a different JSON serialization.",
    "fix": "Use raw request body (req.rawBody) not JSON.stringify(parsedBody)"
  },
  {
    "location": "src/handlers/generic.js:38",
    "severity": "medium",
    "issue": "Signature comparison uses plain string equality (===) which is vulnerable to timing attacks that could leak the expected signature.",
    "fix": "Use crypto.timingSafeEqual() like the GitHub and Stripe handlers"
  },
  {
    "location": "src/handlers/generic.js:49",
    "severity": "high",
    "issue": "Delivery ID tracking has no time window - IDs are stored indefinitely in memory, violating the replay protection requirement in docs/security.md for a configured window.",
    "fix": "Implement TTL cleanup using DELIVERY_ID_WINDOW_MS from security.js"
  },
  {
    "location": "src/handlers/generic.js:100",
    "severity": "critical",
    "issue": "The handler ignores the X-Timestamp header and never validates timestamp age, allowing replay attacks beyond the 5-minute window specified in docs/provider-spec.md.",
    "fix": "Validate X-Timestamp header if present, reject if older than MAX_TIMESTAMP_AGE_MS"
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
    "location": "src/index.js:52",
    "severity": "low",
    "issue": "The server startup log prints whether the webhook secret is configured, which could indicate to an attacker whether the default secret is being used.",
    "fix": "Do not log webhook secret configuration status"
  }
]
```