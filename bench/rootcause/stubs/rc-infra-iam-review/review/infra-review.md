# Infrastructure review

## Critical

- PublicRead bucket, SSH 0.0.0.0/0, dynamodb:* s3:* wildcard, trust Principal, iam:*

## Important

- password secret plain text, AuthorizationType NONE, encryption versioning, point-in-time DeletionPolicy

## Minor

- log retention
