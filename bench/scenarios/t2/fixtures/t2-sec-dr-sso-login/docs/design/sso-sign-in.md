# Single Sign-On Integration Design

**Document ID:** DS-2024-03-SSO  
**Version:** 1.2  
**Status:** In Review  
**Authors:** Platform Security Team, Identity Services Group  
**Last Updated:** 2024-10-15  

## 1. Executive Summary

This document describes the design for adding external identity provider (IdP) single sign-on (SSO) to our B2B web application, Platform+. The current password-based authentication system will remain available for users who prefer it, while enterprise customers can connect their preferred identity providers (Google Workspace, Microsoft Entra ID, Okta, etc.) using OpenID Connect (OIDC).

The integration follows the OAuth 2.0 Authorization Code Flow with PKCE, as recommended for public clients. Users will see a "Sign in with your company" button on the login page, which redirects them to their identity provider. Upon successful authentication, Platform+ receives an ID token and access token, establishes a session, and links the external identity to an existing or new Platform+ account.

## 2. Background and Motivation

### 2.1 Current Authentication Architecture

Platform+ currently uses a homegrown password authentication system with these components:

- **Frontend**: React SPA served via CDN
- **Auth Service**: Node.js microservice handling password validation, session creation, and token issuance
- **Session Store**: Redis cluster for session data
- **User Database**: PostgreSQL with bcrypt-hashed passwords

Sessions currently last 30 days with sliding expiration upon activity. Session tokens are HTTP-only cookies.

### 2.2 Customer Requirements

Enterprise customers have requested SSO support for:
1. Centralized user management through their existing identity systems
2. Compliance with corporate security policies requiring MFA
3. Automated user provisioning/deprovisioning when employees join/leave
4. Reduced password fatigue and helpdesk tickets

### 2.3 Business Impact

- **Target adoption**: 60% of enterprise accounts within 12 months
- **Revenue impact**: Expected 15% increase in enterprise seat purchases
- **Support cost reduction**: Estimated 40% decrease in password-related support tickets

## 3. Technical Design

### 3.1 High-Level Flow

```
User → Platform+ Login Page → Choose IdP → Redirect to IdP
IdP → Authenticate User → Redirect back to Platform+
Platform+ → Exchange code for tokens → Create/Link Account → Establish Session → Redirect to App
```

### 3.2 Authentication Flow Details

When a user selects "Sign in with your company", the frontend will:

1. Generate a random `state` parameter (32 bytes, Base64URL encoded)
2. Construct the authorization request URL to the selected IdP
3. Redirect the user to the IdP's authorization endpoint

The authorization request includes these parameters:
- `client_id`: Our registered client ID with the IdP
- `redirect_uri`: `https://*.platform.plus/auth/callback`
- `response_type`: `code`
- `scope`: `openid email profile`
- `state`: The random state value

Upon return from the IdP, the callback handler will:
1. Verify the `state` parameter matches the stored value
2. Exchange the authorization code for tokens
3. Validate the ID token signature
4. Extract user claims (email, name, etc.)
5. Look up or create a Platform+ account

### 3.3 Account Linking Strategy

To provide a seamless user experience, we will automatically link external identities to Platform+ accounts when possible:

- **New users**: Create a new Platform+ account using email from the ID token
- **Existing users**: If the email in the ID token matches an existing Platform+ account, link the external identity to that account
- **Multiple identities**: Users can link multiple identity providers to a single Platform+ account

The email address from the ID token serves as the primary linking key. If an IdP doesn't provide email (rare), we'll use the `sub` (subject) claim combined with the issuer URL.

### 3.4 Session Management

Successful SSO authentication creates a Platform+ session with these characteristics:

- **Session token**: JWT stored in browser localStorage for easy access by the SPA
- **Duration**: 90 days to match typical enterprise IdP session policies
- **Renewal**: Tokens auto-refresh using the refresh token (when provided by IdP)
- **Revocation**: Sessions persist until explicit logout or token expiry

The session JWT contains these claims:
- User ID
- Authentication method (`password` or `oidc:<provider>`)
- Issued timestamp
- Expiration timestamp

### 3.5 Security Considerations

#### 3.5.1 Token Validation

ID tokens will be validated by:
- Checking the signature using the IdP's public JWKS (JSON Web Key Set)
- Verifying the issuer matches the expected IdP
- Validating the audience includes our client ID
- Checking the token hasn't expired

The IdP's JWKS will be fetched once during application startup and cached indefinitely. Signature validation occurs on every token receipt.

#### 3.5.2 Redirect URI Validation

The `redirect_uri` parameter in authorization requests must match one of the registered redirect URIs for our client. We've registered these patterns with each IdP:

- `https://app.platform.plus/auth/callback`
- `https://*.platform.plus/auth/callback`

The wildcard pattern allows our multi-tenant subdomains to use the same client registration.

#### 3.5.3 State Parameter

The `state` parameter prevents CSRF attacks. We generate a cryptographically random 32-byte value for each authorization request and verify it upon return.

### 3.6 Configuration Management

IdP configurations will be stored in a `providers.yaml` file deployed with the application. This approach centralizes provider settings and ensures consistency across environments. The configuration includes all necessary endpoints, client credentials, and validation settings for each supported identity provider.

```yaml
providers:
  google:
    client_id: "1234567890-abcd.apps.googleusercontent.com"
    client_secret: "GOCSPX-test-secret-123"
    issuer: "https://accounts.google.com"
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth"
    token_endpoint: "https://oauth2.googleapis.com/token"
    jwks_uri: "https://www.googleapis.com/oauth2/v3/certs"
    userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo"
    scopes: ["openid", "email", "profile"]
    
  microsoft:
    client_id: "abcd1234-5678-90ef-ghij-klmnopqrstuv"
    client_secret: "microsoft-test-secret-456"
    issuer: "https://login.microsoftonline.com/common/v2.0"
    authorization_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    jwks_uri: "https://login.microsoftonline.com/common/discovery/v2.0/keys"
    userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo"
    scopes: ["openid", "email", "profile"]
    
  okta:
    client_id: "0oa1a2b3c4d5e6f7g8h9"
    client_secret: "okta-test-secret-789"
    issuer: "https://dev-123456.okta.com/oauth2/default"
    authorization_endpoint: "https://dev-123456.okta.com/oauth2/default/v1/authorize"
    token_endpoint: "https://dev-123456.okta.com/oauth2/default/v1/token"
    jwks_uri: "https://dev-123456.okta.com/oauth2/default/v1/keys"
    userinfo_endpoint: "https://dev-123456.okta.com/oauth2/default/v1/userinfo"
    scopes: ["openid", "email", "profile"]
```

Configuration updates will require a service restart to take effect. We plan to implement dynamic configuration reloading in a future phase to reduce deployment friction for adding new providers or updating existing ones.

### 3.7 Error Handling and User Experience

The SSO flow must handle various error conditions gracefully:

- **IdP unreachable**: Display a user-friendly message with options to retry or fall back to password login
- **Invalid credentials**: Redirect back to login page with appropriate error message
- **Consent required but not granted**: Explain that consent is required and provide retry option
- **Network timeouts**: Implement retry logic with exponential backoff
- **Configuration errors**: Log detailed errors for administrators while showing generic error to users

User experience considerations:
- **Loading states**: Show clear loading indicators during redirects and token exchanges
- **Progress indication**: Provide feedback on each step of the authentication flow
- **Error recovery**: Allow users to easily retry or choose alternative authentication methods
- **Session persistence**: Maintain application state across authentication redirects

## 4. Implementation Plan

### 4.1 Phase 1: Foundation (4 weeks)
- Add OIDC client library to auth service
- Implement generic provider interface
- Create database schema for external identities
- Build admin UI for provider configuration

### 4.2 Phase 2: Google & Microsoft (3 weeks)
- Implement Google OIDC integration
- Implement Microsoft Entra ID integration
- Update login page UI
- Add account linking flows

### 4.3 Phase 3: General Availability (2 weeks)
- Add support for Okta, Auth0, generic OIDC
- Documentation and customer communication
- Monitoring and alerting setup

### 4.4 Phase 4: Enhanced Features (Future)
- SCIM provisioning
- Just-in-time user provisioning
- Conditional access policies

## 5. Performance and Scalability

### 5.1 Expected Load

Based on current traffic and projected adoption:
- **Peak concurrent users**: 50,000
- **Authentication requests/minute**: 1,200 at peak
- **Token validations/minute**: 2,400 (including refreshes)

### 5.2 Resource Requirements

- **Auth Service**: Add 2 CPU cores, 4GB RAM per instance
- **Redis**: Upgrade to cluster with 6 nodes (3 master, 3 replica)
- **Database**: Add read replica for identity queries

### 5.3 Caching Strategy

- **JWKS**: Cache IdP public keys for 24 hours
- **User profiles**: Cache linked user data for 1 hour
- **Provider configurations**: Cache in memory with 5-minute TTL

## 6. Monitoring and Observability

### 6.1 Key Metrics

- SSO authentication success/failure rate
- Average authentication latency by provider
- Account linking success rate
- Session creation rate by method

### 6.2 Alerts

- SSO failure rate > 5% for 5 minutes
- Authentication latency > 2s p95
- Provider configuration errors
- JWKS fetch failures

### 6.3 Logging

All authentication events will be logged with:
- User ID (hashed)
- Authentication method
- Timestamp
- Success/failure
- Error details (if any)
- Provider name

## 7. Testing Strategy

### 7.1 Unit Tests
- Token validation logic
- Account linking algorithms
- State parameter generation/validation

### 7.2 Integration Tests
- End-to-end flow with mock IdP
- Error handling for various IdP failures
- Session creation and management

### 7.3 Security Tests
- CSRF protection validation through state parameter verification
- Token injection attempts simulating malicious ID tokens
- Redirect URI manipulation attempts to test open redirect prevention
- Account linking security tests for both verified and unverified emails
- Session fixation attacks to ensure new sessions are created properly
- Token replay attacks to validate nonce and timestamp checking

### 7.4 Load Tests
- Simulate peak authentication load of 50 requests per second
- Verify Redis session storage performance under concurrent writes
- Test database contention during account linking operations
- Measure JWKS fetch performance during key rotation scenarios
- Validate token validation throughput with multiple concurrent providers
- Test graceful degradation when external IdPs experience latency spikes

### 7.5 Integration Tests with Real Providers
We will establish test accounts with each major provider (Google, Microsoft, Okta) to validate end-to-end flows. These tests will run in a dedicated staging environment and will include:
- Full OIDC flow validation for each provider
- Error condition simulation (invalid tokens, expired sessions)
- Multi-provider scenarios (users with multiple linked identities)
- Session persistence across browser restarts
- Cross-device session sharing validation

## 8. Rollout and Migration

### 8.1 Beta Program
- Invite 5 enterprise customers (approx. 500 users)
- Collect feedback for 2 weeks
- Address critical issues

### 8.2 Gradual Rollout
- Enable for 10% of enterprise customers weekly
- Monitor error rates and performance
- Pause if error rate exceeds 2%

### 8.3 Full Availability
- Announce general availability
- Update documentation and support guides
- Begin deprecation planning for legacy auth (24-month timeline)

## 9. Success Criteria

### 9.1 Technical Success
- SSO authentication success rate > 99.5%
- Average authentication latency < 1.5s
- Zero security incidents related to SSO in first 90 days

### 9.2 Business Success
- 40% of enterprise users adopt SSO within 6 months
- 25% reduction in password-related support tickets
- Positive customer satisfaction survey results (>4.5/5)

### 9.3 Operational Success
- On-call pages related to SSO < 2 per month
- Mean time to resolution for SSO issues < 30 minutes
- Configuration changes deployable within 1 hour

## 10. Open Questions and Risks

### 10.1 Open Questions
1. Should we support SAML in addition to OIDC?
2. How to handle IdP outages gracefully?
3. What is the recovery plan for compromised provider credentials?

### 10.2 Identified Risks
- **IdP dependency**: Outages at providers affect our availability
- **Account takeover**: Malicious linking of existing accounts
- **Configuration drift**: Manual provider config updates may get out of sync
- **Performance variability**: Different IdPs have different response times

## 11. Glossary

- **IdP**: Identity Provider (Google, Microsoft, Okta, etc.)
- **OIDC**: OpenID Connect
- **JWKS**: JSON Web Key Set
- **RP**: Relying Party (our application)
- **JWT**: JSON Web Token
- **MFA**: Multi-Factor Authentication
- **SCIM**: System for Cross-domain Identity Management

---

*This document represents the current design as of October 2024. Implementation details may evolve during development.*