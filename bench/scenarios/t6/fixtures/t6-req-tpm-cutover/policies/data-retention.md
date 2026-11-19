# Data Retention and Privacy Policy

## Policy ID: DRP-2024-01
**Effective Date**: 2024-01-01
**Applicable Systems**: All messaging systems, including RabbitMQ and future Kafka

## Retention Periods
| Data Type | Retention Period | Legal Basis | Notes |
|-----------|-----------------|-------------|-------|
| Order messages | 30 days | Business requirement | Needed for dispute resolution |
| Payment messages | 90 days | PCI-DSS requirement | Audit trail for compliance |
| Fulfillment messages | 14 days | Operational need | Shipment tracking |
| Inventory messages | 7 days | Operational need | Stock reconciliation |
| Dead letter messages | 30 days | Debugging | Investigate failures |
| Consumer offsets | 90 days | Operational | Track consumption progress |

## Migration-Specific Rules
During the migration from RabbitMQ to Kafka:

1. **Dual-running period**: Both systems must retain messages for the standard retention period
2. **Message replay**: Must be possible for 7 days post-migration for verification
3. **Audit trail**: Complete message flow must be traceable across both systems
4. **Decommissioning**: RabbitMQ data must be securely erased after migration completion

## Privacy Considerations
- **PII handling**: Order messages may contain customer names, addresses
- **GDPR compliance**: EU customer data requires special handling
- **Encryption**: All messages must be encrypted at rest and in transit
- **Access control**: Message contents accessible only to authorized services

## Implementation Requirements
1. Kafka topics must be configured with appropriate retention.ms settings
2. Monitoring must alert when retention thresholds are approached
3. Regular compliance audits required
4. Documentation of all retention settings must be maintained

## Exceptions
- Legal hold: May require indefinite retention
- Investigation: May require extended retention with security team approval
- Performance: Extremely high-volume topics may require shorter retention

## Contact
**Policy Owner**: Jamie Wilson (Security)
**Last Reviewed**: 2024-12-01
**Next Review**: 2025-06-01