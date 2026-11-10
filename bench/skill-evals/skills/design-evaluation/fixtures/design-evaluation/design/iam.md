# IAM

- `createExport` role: `dynamodb:PutItem` on Exports.
- `buildExport` role: `dynamodb:*` on `*`, `s3:PutObject` on the exports bucket,
  `secretsmanager:GetSecretValue` on the MailRelay secret.
