# Project Apex: Order Processing Migration

## Executive Summary
Migrate ArcFlow's order-processing message bus from RabbitMQ (self-managed) to AWS Managed Kafka to reduce operational overhead, improve reliability, and enable future scaling.

## Business Case
- **Current**: RabbitMQ 3.8.12 on EC2 (t3.large, 3-node cluster)
- **Target**: AWS Managed Kafka (MSK) with tiered storage
- **Drivers**: 
  - RabbitMQ contract ends 2025-06-30 (cannot renew due to vendor EOL)
  - 40% YoY message volume growth requires better scalability
  - Reduce 24/7 on-call burden for platform team
  - Enable future event-driven architecture

## Scope
- **In Scope**: All order-processing producers/consumers (28 services)
- **Out of Scope**: Non-order messaging (notifications, analytics)

## Success Metrics
- Zero data loss during cutover
- <5 minutes of service degradation
- 99.99% availability post-migration
- 30% reduction in messaging operational cost

## Key Dates
- Requirements final: 2025-01-31
- Dev complete: 2025-03-15  
- UAT: 2025-04-01 to 2025-04-14
- Production cutover: 2025-04-26 (tentative)

## Risks
- Complex message ordering requirements (some consumers require strict FIFO)
- Legacy services with outdated client libraries
- Dependency on other Q2 initiatives

## Dependencies
- Platform team for Kafka configuration
- Security team for network policies
- Finance for contract approvals
- All service teams for implementation

## Stakeholders
- **Sponsor**: Sarah Johnson (VP Engineering)
- **TPM**: Maya Chen
- **Platform Lead**: Alex Rodriguez
- **Security**: Jamie Wilson