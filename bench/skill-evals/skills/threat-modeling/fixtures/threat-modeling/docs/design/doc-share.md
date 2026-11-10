# DocShare design

Service: DocShare. Owner team: Collaboration.

## Scope for this review
In scope: creating and opening share links. Out of scope: billing, the admin console, and search.

## Components
- **Web client** (React SPA) served from CloudFront.
- **Amazon Cognito user pool** for sign-in. Users get a JWT.
- **API Gateway (REST)** `docshare-api`, Cognito authorizer on all routes except `GET /s/{token}`.
- **Lambda `share-handler`**:
  - `POST /shares` (authenticated): owner picks a document and a recipient email. The Lambda creates a random 128-bit token, stores `{token, docKey, ownerId, recipientEmail, expiresAt}` in DynamoDB, and emails the link `https://docshare.example.com/s/{token}` to the recipient via SES.
  - `GET /s/{token}` (unauthenticated): looks up the token, checks `expiresAt`, and returns a 15-minute S3 presigned GET URL for `docKey`.
- **DynamoDB table `Shares`**, partition key `token`. Encrypted with AWS owned key.
- **S3 bucket `docshare-docs`**, SSE-KMS with a customer-managed key, Block Public Access on.
- **Amazon SES** for outbound email.
- **CloudWatch Logs** for Lambda logs (the handler logs the full request event).

## Data
Documents are customer contracts (Confidential). Recipient emails are PII.

## Not built yet
No rate limiting on `GET /s/{token}`. Shares cannot be revoked before expiry. Expiry defaults to 30 days.
