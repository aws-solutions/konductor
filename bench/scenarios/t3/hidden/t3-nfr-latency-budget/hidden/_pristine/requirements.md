# E-Commerce Checkout System - Non-Functional Requirements

## System Overview
The checkout system processes customer orders through a sequence of microservices. Each request must pass through several stages in a defined order.

## Service Chain
1. **API Gateway** - Entry point, request routing, basic validation
2. **Authentication Service** - User authentication and session validation  
3. **Pricing Service** - Calculate item prices, apply promotions and taxes
4. **Inventory Service** - Check product availability, reserve stock
5. **Payment Service** - Process payment transactions

## Performance Requirements

### Latency Requirements
- End-to-end p99 latency for checkout requests: **≤ 600 ms**
- The system must handle 95% of requests within 400 ms
- Peak traffic periods (Black Friday): system should maintain SLAs with 3x normal load

### Throughput Requirements  
- Normal operation: 100 requests per second (RPS)
- Peak capacity: 300 RPS sustained for 2 hours
- Maximum burst capacity: 500 RPS for 5 minutes

### Availability Requirements
- System availability: 99.9% (three nines)
- Monthly downtime budget: 43.8 minutes
- Critical payment operations: 99.99% availability

## Data Requirements
- Maximum order size: 50 items
- Session data retention: 30 days
- Order history retention: 7 years for compliance

## Recovery Requirements
- Recovery Point Objective (RPO): 5 minutes for payment data
- Recovery Time Objective (RTO): 15 minutes for full system restore
- Data loss tolerance: Zero for financial transactions

## Cost Constraints
- Monthly infrastructure budget: **$1,000 USD**
- All optimizations must fit within this budget
- Cost overruns require architectural review and approval