# Payments ledger: system design (approved)

The ledger records every money movement for the wallet product. Writes come from the
payments service (`POST /entries`), reads come from the mobile app (`GET /accounts/{id}/balance`,
`GET /accounts/{id}/entries`). Traffic today is about 400 writes/s and 2,500 reads/s at peak, with a
3x seasonal spike in December.

Architecture: API Gateway, Lambda (Node.js 20), DynamoDB with streams feeding an
OpenSearch index for statement search. Deployed in us-east-1 with a warm standby in us-west-2.

The ledger must be fast, highly available and secure. It handles cardholder data, so
it is in PCI scope. It should scale to handle growth and be easy to monitor. We
should keep logs for a reasonable time. The budget is about $9,000 per month.
