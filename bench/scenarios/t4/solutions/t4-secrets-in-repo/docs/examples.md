# Request examples

A local request can look like this:

```json
{"channel":"sms","to":"+1 555 0100","body":"Your one-time code is 123456"}
```

For local signing experiments, set `WEBHOOK_SIGNING_SECRET` in the process environment. Do not paste key material into request examples.
