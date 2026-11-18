# Design review

## Gaps

- [high] §5: The admin refund endpoint has no authorization; anyone can refund an order.
- [medium] §2: No latency target; "fast" has no number.
- [medium] §8: No migration or rollback plan for the new table and status values.
