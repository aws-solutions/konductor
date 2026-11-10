# Key: cost-estimation
estimate-v1.csv omits: internet data transfer (1M req/day x 150 KB = ~4.5 TB/mo, CloudFront free tier is 1 TB), Fargate, Aurora, SQS, CloudWatch Logs (~150 GB/mo), S3 growth of 300 GB/mo. Corrected total is well above $402.
