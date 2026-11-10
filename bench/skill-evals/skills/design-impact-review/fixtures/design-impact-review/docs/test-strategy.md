# Test strategy

- Contract tests in tests/contract/ pin the GET /members/{id} response shape.
- Component tests for web/src/ProfileCard.tsx render name and email.
- Authorization tests: non-owner gets 403.
