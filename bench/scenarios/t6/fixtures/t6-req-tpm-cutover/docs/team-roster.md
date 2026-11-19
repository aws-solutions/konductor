# Project Apex: Team Roster

## Core Team
| Role | Name | Contact | Notes |
|------|------|---------|-------|
| TPM | Maya Chen | maya.chen@arcflow.io | Project lead, cutover coordinator |
| Platform Lead | Alex Rodriguez | alex.rodriguez@arcflow.io | Kafka SME, infrastructure |
| Security Lead | Jamie Wilson | jamie.wilson@arcflow.io | Compliance, network policies |
| Order Service Lead | Samir Patel | samir.patel@arcflow.io | Main producer service |
| Payment Service Lead | Lisa Wong | lisa.wong@arcflow.io | Consumer with ordering requirements |
| Fulfillment Lead | Tom Harris | tom.harris@arcflow.io | High-volume consumer |

## Extended Team (Service Owners)
| Service | Owner | Team Size | Migration Complexity |
|---------|-------|-----------|---------------------|
| Order API | Samir Patel | 4 | High (primary producer) |
| Payment Processor | Lisa Wong | 3 | Medium (ordering sensitive) |
| Fulfillment Engine | Tom Harris | 5 | Low |
| Inventory Manager | Maria Garcia | 2 | Medium |
| Shipping Service | David Kim | 2 | Low |
| Notification Service | Alex Rodriguez | 1 | Low |
| Analytics Pipeline | Taylor Smith | 3 | Medium |

## On-Call Rotation (Cutover Weekend)
- **Primary**: Alex Rodriguez (platform)
- **Secondary**: Maya Chen (TPM)
- **Tertiary**: Jamie Wilson (security)

## Sign-off Authority
- **Technical**: Alex Rodriguez (Platform Lead)
- **Business**: Sarah Johnson (VP Engineering)
- **Security**: Jamie Wilson
- **Production Deployment**: Maya Chen + all service leads

## Escalation Path
1. Team lead
2. Maya Chen (TPM)
3. Sarah Johnson (VP Engineering)
4. CIO (emergency only)