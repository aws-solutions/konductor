# Review

This PR has a serious security gap at both trust boundaries. The inbound verifier changes the signed representation and does not bind a delivery to a recent, unique request. The outbound path treats tenant configuration as a safe network destination, while startup can leave the service using a shared known secret. I would not approve this for a tenant-facing rollout until the findings below are fixed. The diagnostic path also turns an authentication failure into a credential disclosure in logs.

- **High, request verification:** `src/webhooks/receiver.js:24` signs `JSON.stringify(body)` after parsing. The provider contract signs the exact UTF-8 request bytes, so valid deliveries with whitespace or property-order differences will be rejected and the verifier is no longer checking the provider's signed representation. Verify the raw body before parsing it.
- **Medium, comparison timing:** `src/webhooks/signatures.js:14` uses ordinary string equality for an HMAC header. Use a timing-safe comparison such as `crypto.timingSafeEqual` after validating equal-length decoded values.
- **Medium, delivery freshness:** `src/router.js:10` accepts every correctly signed event and immediately stores and forwards it. The provider contract requires a 300-second timestamp window and a unique delivery identifier, so an intercepted valid request can be replayed to repeat a customer action. Enforce the timestamp and replay window and atomically record the delivery ID before notification.
- **Critical, outbound request destination:** `src/notify/callback.js:12` sends to the configured URL and follows redirects without validating the destination. A customer-controlled setting can make the service connect to private network services or cloud metadata. Validate an HTTPS destination against an explicit customer allowlist, reject private and metadata addresses, and apply the same policy to redirects.
- **High, default signing secret:** `src/config.js:9` substitutes `test_key_123` when `WEBHOOK_SECRET` is absent. A deployment that forgets configuration then shares a source-visible credential with every other defaulted deployment. Require a non-empty environment secret and fail startup closed.
- **High, credential disclosure:** `src/webhooks/receiver.js:32` passes the complete signature header to the warning logger. The header is authentication material and can be retained or read by log consumers. Log only provider, delivery, and failure metadata, with the signature value removed or redacted.

```json
[
  {
    "location": "src/webhooks/receiver.js:24",
    "severity": "high",
    "issue": "The receiver verifies a JSON re-serialization instead of the exact request bytes, so the provider's signed representation is not the one being checked and valid deliveries can fail.",
    "fix": "Verify the raw body bytes before parsing JSON."
  },
  {
    "location": "src/webhooks/signatures.js:14",
    "severity": "medium",
    "issue": "The HMAC header uses ordinary string equality, which exposes a timing signal during signature guesses.",
    "fix": "Decode equal-length values and compare them with crypto.timingSafeEqual."
  },
  {
    "location": "src/router.js:10",
    "severity": "medium",
    "issue": "The route accepts and forwards signed deliveries without the documented timestamp replay window or delivery-ID deduplication, so a captured event can repeat a customer action.",
    "fix": "Enforce the timestamp and replay window and atomically record each delivery ID before forwarding."
  },
  {
    "location": "src/notify/callback.js:12",
    "severity": "critical",
    "issue": "The callback follows a customer-configured URL without validating its destination, allowing requests to private services or cloud metadata.",
    "fix": "Validate an HTTPS allowlist, block private and metadata addresses, and revalidate redirects."
  },
  {
    "location": "src/config.js:9",
    "severity": "high",
    "issue": "A missing environment secret silently activates the source-visible default, allowing an unconfigured deployment to accept a known credential.",
    "fix": "Require the environment variable and fail closed when the secret is empty."
  },
  {
    "location": "src/webhooks/receiver.js:32",
    "severity": "high",
    "issue": "The invalid-signature warning includes the complete authentication header, exposing reusable signing material to log readers and retained log systems.",
    "fix": "Remove the signature header from logs and redact any diagnostic credential fields."
  }
]
```
