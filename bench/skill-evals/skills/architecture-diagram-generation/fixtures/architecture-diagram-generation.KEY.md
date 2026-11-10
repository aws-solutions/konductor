# Key: architecture-diagram-generation
- system-design.md: single account, us-east-1, VPC holds Fargate + Aurora; CloudFront, WAF, S3, API GW, Lambda, DynamoDB, SQS, Cognito sit outside the VPC.
- diagrams/legacy.drawio (p3) planted problems: S3 icon geometrically inside the VPC box; no account or region boundary; edges unlabeled with endArrow=none; no title.
