# Current Authentication Architecture
**Last Updated:** 2024-09-30  
**Owner:** Platform Infrastructure Team

## Overview
Platform+ uses a traditional password-based authentication system with session management via HTTP-only cookies. The system is designed for high availability and moderate security requirements.

## Components

### 1. Frontend (React SPA)
- Served via CloudFront CDN
- Communicates with backend via REST API
- Manages login form and session token storage
- **Current behavior**: Stores session token in HTTP-only cookie only

### 2. Authentication Service
- Node.js + Express microservice
- Handles password validation, session creation, token issuance
- Rate limiting: 5 attempts per minute per IP
- Password hashing: bcrypt with cost factor 12

### 3. Session Store
- Redis cluster (3 master, 3 replica)
- Stores: session ID, user ID, creation time, last activity, metadata
- TTL: 30 days with sliding expiration on activity
- Encryption: AES-256-GCM for sensitive session data

### 4. User Database
- PostgreSQL (primary + 2 read replicas)
- Tables: users, password_hashes, login_history, mfa_devices
- Encryption: at-rest encryption enabled
- Backups: hourly incremental, daily full

## Current Flow

### Login Flow
```
1. User submits credentials via HTTPS
2. Frontend POST to /api/v1/auth/login
3. Auth service validates credentials
4. If valid: generate session token, store in Redis
5. Set HTTP-only cookie with session token
6. Return user profile data
```

### Session Validation Flow
```
1. Frontend includes session cookie in all requests
2. API gateway extracts cookie, forwards to auth service
3. Auth service validates token, checks Redis for active session
4. If valid: update last_activity, proceed with request
5. If invalid/expired: return 401, clear cookie
```

### Logout Flow
```
1. User clicks logout
2. Frontend POST to /api/v1/auth/logout
3. Auth service removes session from Redis
4. Clear session cookie
5. Return success response
```

## Security Controls

### Current Controls
- HTTPS everywhere (TLS 1.3)
- HTTP-only cookies for session tokens
- CSRF tokens for state-changing operations
- Rate limiting on authentication endpoints
- Password complexity requirements (12+ chars, mixed case, numbers, symbols)
- Failed attempt locking (5 attempts → 15 minute lockout)

### Monitoring
- Real-time alerting for suspicious patterns
- Geographic anomaly detection (>500km travel in <1 hour triggers review)
- Device fingerprinting for risk assessment
- Weekly security audit logs review

## Limitations and Pain Points

### Known Issues
1. **Session duration**: 30 days is too long per security review
2. **No step-up auth**: Sensitive operations don't require reauthentication
3. **Password fatigue**: High support ticket volume for password resets
4. **Enterprise integration**: No support for corporate identity providers
5. **MFA optional**: Only 35% of users have enabled MFA

### Performance Metrics
- **Login success rate**: 99.7%
- **Average login latency**: 850ms p95
- **Session validation latency**: 45ms p95
- **Concurrent sessions**: ~45,000 peak

## Dependencies
- **Redis**: Session storage (critical path)
- **PostgreSQL**: User data (critical path)
- **SMTP service**: Password reset emails (degraded mode available)
- **Monitoring stack**: Prometheus, Grafana, ELK

## Future Considerations
The current system works well for B2C use cases but lacks enterprise features. The SSO integration will need to coexist with this system during a transition period of at least 24 months.