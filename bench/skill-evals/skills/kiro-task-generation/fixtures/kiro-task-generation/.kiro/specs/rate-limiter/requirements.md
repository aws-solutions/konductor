# Requirements Document: API Rate Limiter

## Requirements

### Requirement 1

**User Story:** As a platform operator, I want each API key limited to a request rate, so that one client cannot starve others.

#### Acceptance Criteria

1.1 WHEN a key exceeds 100 requests in a rolling 60-second window THEN the API SHALL respond 429 with a Retry-After header.
1.2 WHEN a request is allowed THEN the response SHALL include X-RateLimit-Remaining.

### Requirement 2

**User Story:** As a platform operator, I want per-plan limits, so that paid plans get more capacity.

#### Acceptance Criteria

2.1 WHEN a key belongs to the PRO plan THEN its limit SHALL be 1,000 requests per 60 seconds.
2.2 IF the plan lookup fails THEN the limiter SHALL apply the FREE limit and log a warning.

### Requirement 3

**User Story:** As an SRE, I want the limiter to fail open, so that a Redis outage does not take the API down.

#### Acceptance Criteria

3.1 IF Redis is unreachable for a request THEN the request SHALL be allowed and a metric `ratelimit.failopen` SHALL be incremented.
