# Security Hub finding

Control: S3.8 / S3 general purpose buckets should block public access
Severity: HIGH
Resource: arn:aws:s3:::doc-share-test-tmp-2024
Account: 444455556666 (doc-share production account)
First observed: 2026-10-30
Notes: bucket policy grants s3:GetObject to Principal "*". No tags on the bucket.
