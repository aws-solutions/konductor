# Data model

## Member (DynamoDB table `members`, PK `id`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | Cognito sub |
| fullName | string | 1-120 chars |
| email | string | PII |
| createdAt | string | ISO-8601 |
