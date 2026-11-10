# Threat model: Member Profiles

## Data classification

| Field | Class |
|-------|-------|
| fullName | Internal |
| email | PII (confidential) |

## Trust boundaries

- Browser to API Gateway (Cognito JWT required).
- Lambda to DynamoDB (IAM role scoped to `members`).

## Threats

- T1 Information disclosure: a member reads another member's email. Mitigation: owner check on `sub`.
