# Authentication and Identity Glossary

## Core Concepts

**Authentication (AuthN)**
The process of verifying the identity of a user or system. In Platform+, this includes password validation, multi-factor authentication, and single sign-on.

**Authorization (AuthZ)**
Determining what an authenticated user is allowed to do. Separate from but dependent on authentication.

**Single Sign-On (SSO)**
An authentication scheme that allows users to log in with a single identity to multiple independent software systems.

**OpenID Connect (OIDC)**
An identity layer built on top of OAuth 2.0 that enables clients to verify the identity of end-users based on authentication performed by an authorization server.

## Technical Terms

**Identity Provider (IdP)**
A system that creates, maintains, and manages identity information while providing authentication services. Examples: Google, Microsoft Entra ID, Okta.

**Relying Party (RP)**
The application that relies on the IdP for authentication. In our case, Platform+ is the relying party.

**JSON Web Token (JWT)**
A compact, URL-safe means of representing claims to be transferred between two parties. Used for ID tokens and session tokens.

**JSON Web Key Set (JWKS)**
A set of keys containing the public keys used to verify any JWT issued by the authorization server.

**Authorization Code Flow**
The OAuth 2.0 flow where the client exchanges an authorization code for an access token. Used by confidential clients (servers).

**PKCE (Proof Key for Code Exchange)**
Extension to authorization code flow that prevents authorization code interception attacks. Required for public clients (SPAs).

**State Parameter**
A random string sent in the authorization request and returned in the callback, used to prevent CSRF attacks.

**Nonce**
A random string sent in the authorization request and included in the ID token, used to prevent replay attacks.

**ID Token**
A JWT that contains claims about the authentication of an end-user. Provides identity information.

**Access Token**
A token used to access protected resources on behalf of the user.

**Refresh Token**
A token used to obtain new access tokens without re-authenticating the user.

## Platform+ Specific Terms

**Platform+ Account**
The primary user account in our system, which can be linked to multiple external identities.

**External Identity**
An identity from an external IdP (Google account, Microsoft account, etc.) linked to a Platform+ account.

**Account Linking**
The process of associating an external identity with a Platform+ account, either automatically by email match or manually by user confirmation.

**Session Token**
A JWT issued by Platform+ after successful authentication, used to maintain user sessions.

**Step-up Authentication**
Requiring additional authentication (re-entering password, MFA) for sensitive operations.

**Back-channel Logout**
A mechanism where the IdP notifies the RP directly when a user logs out, allowing immediate session termination.

## Security Terms

**CSRF (Cross-Site Request Forgery)**
An attack that tricks a user into performing unwanted actions on a web application in which they're authenticated.

**Token Binding**
Associating an access token with a specific client to prevent token replay.

**Credential Stuffing**
An attack where stolen username/password pairs are used to gain unauthorized access to user accounts.

**Account Takeover**
Unauthorized access to a user's account, typically through credential theft or session hijacking.

**MFA (Multi-Factor Authentication)**
Authentication using two or more factors: something you know (password), something you have (phone), something you are (biometric).

## Compliance and Policy Terms

**PII (Personally Identifiable Information)**
Information that can be used to identify an individual.

**Data Retention Period**
The length of time data is kept before being deleted, per compliance requirements.

**Audit Log**
Immutable record of security-relevant events for compliance and investigation.

**Incident Response Time**
The time from detection to containment of a security incident.

**Mean Time to Detection (MTTD)**
Average time between a security event occurring and its detection.

**Mean Time to Resolution (MTTR)**
Average time between detection of a security incident and its resolution.