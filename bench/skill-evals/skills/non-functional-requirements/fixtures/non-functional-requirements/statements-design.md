# Statements service: system design (draft for review)

Customers download monthly statements and search their transaction history from the mobile app.

## Components
- `GET /statements/search?q=` - interactive search over the OpenSearch index fed by the ledger's DynamoDB stream. Called while the user types (debounced); about 300 requests/s at peak.
- `POST /statements/export` - queues a PDF export for a date range. A Lambda (Python 3.12, 1 GB) renders the PDF, writes it to S3, and emails a pre-signed link through SES. Exports cover up to 24 months of entries.
- Nightly month-end job (Step Functions + Lambda) pre-renders every active account's statement on the 1st of the month. 2.1M active accounts today, growing about 4% per month.

## Constraints
- Statements contain cardholder names and masked PANs, so the service is in PCI scope like the ledger.
- Pre-signed links must not outlive the customer's session security policy (Security has asked for "short-lived").
- Same regions as the ledger: us-east-1 primary, us-west-2 warm standby.
- Product wants search to "feel instant" and month-end statements "ready in the morning".
- Budget: about $3,500 per month.
