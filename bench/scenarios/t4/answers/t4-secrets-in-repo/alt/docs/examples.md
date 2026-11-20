# Request examples

A local request can look like this:

```json
{
    "body": "Your one-time code is 123456",
    "to": "+1 555 0100",
    "channel": "sms"
}
```

For local signing experiments, set `WEBHOOK_SIGNING_SECRET` in the process environment. Do not paste key material into request examples.
