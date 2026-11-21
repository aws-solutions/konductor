# Design Review: SSO Integration for Platform+

**Reviewer:** Security Architecture Team  
**Date:** 2024-10-20  
**Document Reviewed:** `docs/design/sso-sign-in.md` (v1.2)  
**Status:** Requires significant revisions

## Overall Assessment

The design provides a reasonable starting point for OIDC integration but contains several security-critical issues that must be addressed before implementation. The most concerning problems involve account takeover risks, session management violations of security policy, and missing OpenID Connect required parameters. The design also shows insufficient attention to recent incident lessons, particularly regarding session duration and revocation.

## Key Risks

1. **Account takeover vulnerability**: Automatic linking by email without verification allows attackers to claim existing accounts if they can register an unverified email with an IdP.
2. **Session security regression**: Moving from HTTP-only cookies to localStorage represents a security downgrade that enables XSS attacks to steal session tokens.
3. **Compliance violations**: Multiple aspects (session duration, token storage) contradict established security policies.
4. **Missing OIDC requirements**: Omitting the nonce parameter leaves the system vulnerable to replay attacks.
5. **Overly permissive redirect URIs**: Wildcard patterns create attack surface for open redirect vulnerabilities.

The design needs substantial revision to meet security requirements while maintaining the user experience goals. Below are detailed findings.

## Findings

```json
[
  {
    "location": "3.2",
    "severity": "high",
    "issue": "Authorization flow omits the nonce parameter required by OpenID Connect Core 1.0 section 3.1.2.1 for replay attack prevention.",
    "fix": "Add nonce parameter to authorization requests and validate it against the ID token's nonce claim."
  },
  {
    "location": "3.3",
    "severity": "critical",
    "issue": "Account linking uses email matching without checking the email_verified claim, enabling account takeover if an IdP provides unverified emails.",
    "fix": "Require email_verified claim to be true before automatic account linking, or implement manual confirmation for unverified emails."
  },
  {
    "location": "3.4",
    "severity": "high",
    "issue": "Session tokens stored in browser localStorage violates security policy requirement for HTTP-only cookies and enables XSS token theft.",
    "fix": "Use HTTP-only cookies for session tokens as per current architecture and security policy."
  },
  {
    "location": "3.4",
    "severity": "medium",
    "issue": "90-day session duration exceeds security policy maximum of 30 days, increasing exposure window from account takeover incidents.",
    "fix": "Reduce session duration to 30 days maximum with sliding expiration, or implement step-up authentication for longer sessions."
  },
  {
    "location": "3.4",
    "severity": "medium",
    "issue": "Sessions persist without back-channel revocation checks despite security policy requiring them when supported.",
    "fix": "Implement back-channel logout or token status endpoint polling for providers that support it."
  },
  {
    "location": "3.5.1",
    "severity": "medium",
    "issue": "JWKS fetched once at deploy and cached indefinitely contradicts configuration template requiring refresh every 24 hours minimum.",
    "fix": "Implement JWKS refresh with reasonable TTL (e.g., 24 hours) and retry logic for key rotation scenarios."
  },
  {
    "location": "3.5.2",
    "severity": "high",
    "issue": "Wildcard redirect URI pattern allows any subdomain to receive authentication codes, enabling open redirect attacks.",
    "fix": "Use explicit redirect URIs or implement strict validation against allowed subdomains list."
  }
]
```