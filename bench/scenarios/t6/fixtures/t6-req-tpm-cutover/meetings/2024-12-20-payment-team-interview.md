# Payment Team Interview Notes

**Date**: 2024-12-20
**Interviewer**: Maya Chen
**Interviewee**: Lisa Wong (Payment Service Lead)

## Ordering Requirements
Lisa: "Our payment processing is time-sensitive and order-sensitive. If payment authorization comes before order creation, we reject it. If capture comes before authorization, fraud system flags it."

**Key points**:
- Must process messages in the order they were created
- Maximum 5-second delay between related messages
- Cannot handle duplicates (causes double charges)
- Currently uses single RabbitMQ queue with one consumer

**Impact of out-of-order**:
- 15% transaction failure rate
- Manual reconciliation required
- Customer service tickets increase 3x

## Volume Patterns
- Peak: 12:00-20:00 UTC (US business hours)
- Low: 00:00-06:00 UTC
- Weekly pattern: Monday highest, Sunday lowest
- Seasonal: 30% increase in November-December

## Failure Modes
1. **Duplicate messages**: Customer charged twice
2. **Out-of-order**: Payment fails, order continues (inventory issues)
3. **Delayed messages**: Payment timeout, order cancellation

## Testing Requirements
- Need to validate ordering guarantee
- Must test with production-like load
- Require dry-run with actual messages (not synthetic)

## Migration Concerns
- "Can we maintain ordering during cutover?"
- "What happens to in-flight messages?"
- "How do we validate before going live?"

## Special Notes
- PCI-DSS compliance requires audit trail of all messages
- Fraud detection system has strict timing requirements
- Partner APIs (Stripe, PayPal) have 30-second timeout windows