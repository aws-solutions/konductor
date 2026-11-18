# Design review

## Gaps

- [high] §3: The payment provider can time out and nothing says what happens to the reserved stock.
- [medium] The clocks of the nodes may differ, so reservations expire at different times.
- [medium] There is no idempotency for reserve calls.
- [medium] There is no rate limiting on reserve.
- [low] There is no monitoring or alarm.
- [low] Personal data retention is not stated.
