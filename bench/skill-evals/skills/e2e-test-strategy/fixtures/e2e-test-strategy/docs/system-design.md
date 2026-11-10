# System Design: TaskFlow

- Frontend: React SPA on CloudFront + S3.
- Auth: Cognito user pool; API Gateway Cognito authorizer on every route.
- API: API Gateway REST -> Lambda (Node 20) -> DynamoDB single table.
- Email: SES for invites and password reset links. Reset tokens are stored in DynamoDB with a TTL.
- Async: task-shared events go to EventBridge; a Lambda consumer sends the SES invite.
- CI: GitHub Actions; ephemeral "preview" stack per PR; shared "staging" stack.
- Team: 5 engineers. 3 have shipped Playwright suites before; nobody has used Cypress.
