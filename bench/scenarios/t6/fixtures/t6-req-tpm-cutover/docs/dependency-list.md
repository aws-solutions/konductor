# Project Apex: Dependencies

## External Dependencies
| Dependency | Owner | Status | Impact |
|------------|-------|--------|--------|
| AWS MSK provisioning | Cloud Team | Pending | Blocking - need 2 weeks lead time |
| VPC peering setup | Network Team | In progress | Blocking |
| SSL certificate renewal | Security Team | Not started | Blocking (expires 2025-04-15) |
| Monitoring dashboard | Platform Ops | Partially done | Required for go/no-go |
| Contract approval | Finance | In review | Blocking for AWS spend |
| Security review | Security Team | Scheduled | Gate before UAT |

## Internal Dependencies (Service Teams)
| Service | Dependencies | Special Requirements | Timeline Risk |
|---------|--------------|----------------------|---------------|
| Order API | None | Message ordering guarantee | Low |
| Payment Processor | Order API | Must process in sequence | High (critical) |
| Fulfillment Engine | Order API | Can handle duplicates | Medium |
| Inventory Manager | Order API | Idempotent processing | Low |
| Shipping Service | Fulfillment Engine | Tolerates 5-minute delay | Low |
| Notification Service | All services | Best-effort delivery | Low |
| Analytics Pipeline | All services | Batch processing okay | Low |

## Technical Dependencies
1. **Kafka Client Libraries** - All services must upgrade to compatible versions
2. **Message Schema** - Avro schema registry setup required
3. **Retry Logic** - Need circuit breaker implementation
4. **Dead Letter Queues** - Must be maintained during migration
5. **Consumer Lag Monitoring** - New alerts needed

## Cross-Project Dependencies
- **Data Retention Policy** (see `policies/data-retention.md`): Affects dual-running duration
- **Change Freeze Calendar**: Q2 has multiple freezes (see `data/change-calendar.csv`)
- **Other Q2 Initiatives**: "Payment Gateway Upgrade" conflicts with our UAT window

## Risk Dependencies
- **High**: Payment Processor ordering requirements
- **Medium**: SSL certificate timeline
- **Medium**: Security review completion
- **Low**: Monitoring dashboard readiness