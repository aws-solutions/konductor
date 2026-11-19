# AnalyticsHub - Analytics Platform

AnalyticsHub is a modern business intelligence platform that provides interactive dashboards, data visualization, and reporting capabilities for enterprise customers.

## Architecture Overview

### Current Components
- **Frontend**: React SPA with TypeScript
- **Backend**: Node.js microservices (Express)
- **Database**: PostgreSQL for metadata, ClickHouse for analytics
- **Cache**: Redis for session and query results
- **Infrastructure**: AWS ECS, RDS, ElastiCache

### Data Pipeline
1. Source systems → S3 landing zone
2. ETL jobs (Glue/Spark) → Data warehouse
3. Aggregation layer → Presentation database
4. API layer → Frontend applications

## Existing Export Capabilities

### Current Limitations
- Only supports export of dashboard visualizations as PNG
- Maximum 10,000 rows for CSV export (legacy limit)
- No support for large dataset exports
- No async or scheduled export functionality

### User Feedback
- **Top requested feature**: Large dataset CSV export (85% of survey respondents)
- **Pain point**: Manual copy-paste for data > 10,000 rows
- **Workaround**: Users run direct database queries (security concern)

## Technical Constraints

### API Layer
- Built on API Gateway + Lambda
- Maximum request timeout: 29 seconds (Gateway limit)
- Payload size limit: 10MB (can be increased to 100MB)
- Authentication: JWT tokens with 1-hour expiry

### Data Access Layer
- Query execution timeout: 60 seconds
- Maximum result set: 50 million rows (theoretical)
- Connection pooling: 100 concurrent connections
- Read replicas available for reporting workloads

### Frontend Constraints
- Single page application (no page reloads)
- File download via blob URLs
- Maximum blob size: 2GB (browser limit)
- No background processing support

## Development Guidelines

### Code Standards
- TypeScript strict mode enabled
- ESLint with Airbnb config
- Prettier for code formatting
- Jest for unit testing
- Cypress for E2E testing

### Deployment
- CI/CD via GitHub Actions
- Staging environment for all changes
- Blue-green deployment for production
- Rollback window: 30 minutes

### Monitoring
- CloudWatch for metrics and logs
- X-Ray for distributed tracing
- PagerDuty for alerts
- Weekly performance reviews

## Project Structure
```
analyticshub/
├── frontend/          # React application
├── backend/           # Node.js microservices
├── data-pipeline/     # ETL and data processing
├── infrastructure/    # Terraform/CDK
└── docs/             # Documentation
```

## Team
- **Product**: 2 PMs, 1 Designer
- **Engineering**: 8 Full-stack developers
- **Data**: 3 Data engineers
- **DevOps**: 2 Infrastructure engineers

## Timeline
- **Current**: Q2 2024 - Foundation phase
- **Next**: Q3 2024 - Advanced features (including report export)
- **Future**: Q4 2024 - Enterprise capabilities

## Related Documents
- [Architecture Decision Records](./adr/)
- [API Specifications](./api-specs/)
- [Data Dictionary](./data-dictionary/)
- [Security Compliance](./security/)