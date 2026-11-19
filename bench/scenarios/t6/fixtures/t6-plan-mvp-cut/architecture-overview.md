# System Architecture Overview

## Components
1. **Frontend** - React application for tenants and managers
2. **Backend API** - Node.js with Express
3. **Database** - PostgreSQL with audit tables
4. **Payment Processing** - Integration with Stripe API
5. **File Storage** - AWS S3 for document storage
6. **Email/SMS** - Notification service

## Integration Points
- Stripe API for payments
- Twilio for SMS notifications
- AWS services for infrastructure
- Future: Property management system API

## Security Architecture
- JWT-based authentication
- Role-based access control
- Encryption at rest and in transit
- Audit logging for compliance

## Deployment
- Docker containers
- Kubernetes orchestration
- CI/CD pipeline with GitHub Actions
- Separate environments: dev, staging, prod