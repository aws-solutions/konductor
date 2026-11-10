# Requirements Document: Auth Token Refresh

## Requirements

### Requirement 1

**User Story:** As a signed-in user, I want my session to refresh silently, so that I am not logged out while working.

#### Acceptance Criteria

1.1 WHEN the access token has less than 60 seconds left THEN the client SHALL request a new token with the refresh token.
1.2 WHEN refresh succeeds THEN the client SHALL retry the original request once.
1.3 IF refresh fails with 401 THEN the client SHALL clear the session and redirect to sign-in.

### Requirement 2

**User Story:** As a security engineer, I want refresh tokens rotated, so that a stolen refresh token has limited use.

#### Acceptance Criteria

2.1 WHEN a refresh token is used THEN the server SHALL issue a new refresh token and revoke the old one.
2.2 IF a revoked refresh token is presented THEN the server SHALL revoke the whole token family and return 401.
2.3 WHEN two refresh calls race with the same token THEN only one SHALL succeed.
