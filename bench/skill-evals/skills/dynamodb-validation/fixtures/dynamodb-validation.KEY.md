# Answer key: dynamodb-validation fixture

- CRITICAL: PK=status has 5 values at 2,000 writes/sec -> hot partitions (low cardinality, Pitfall/Category 1).
- CRITICAL: GSI1 WCU 200 < base 2,500 WCU -> GSI throttling cascade (Pitfall 1).
- CRITICAL: AP1 get-by-orderId is a Scan at 5,000/sec; AP5 list-all is a Scan at 20/sec (>10/sec rule).
- CRITICAL: AP4 has no supporting index.
- CRITICAL: encryption not specified; no backup/PITR.
- HIGH: receiptPdf 250-380 KB near the 400 KB item limit; lineItems up to 200 -> can exceed it. Store in S3.
- HIGH: write then immediate GSI1 query assumes strong consistency (Pitfall 7).
- MEDIUM: GSI1 projection ALL copies receiptPdf into the index.
- MEDIUM: sessionToken is temporary data with no TTL.
- HIGH: no CloudWatch alarms incl. GSI throttling.
- Data model: createdAt as S is fine; mixed types fine.

v2 iteration (p3) notes:
- Resolved by v2: hot status PK, 400 KB item risk (receipts in S3), GSI1 WCU below base, PITR, SSE-KMS, TTL on sessionToken, GSI projection ALL copying receipts.
- Still open (named in the prompt): AP4 seller-by-day has no index, AP5 admin list-all is a Scan at 20/sec, no alarms (including GSI throttling).
- NEW issues introduced by v2 that the prompt does not mention:
  - AP3 (list PENDING orders older than 1 hour) was served by PK=status in v1; with PK=orderId and no SK it now has no supporting index (needs e.g. a sparse GSI on status/createdAt).
  - GSI1 KEYS_ONLY means AP2 (2,000/sec, list a customer's orders) must fetch every item with GetItem/BatchGetItem; INCLUDE projection of the list-view attributes is the usual fix.
- Still applies: checkout page queries GSI1 right after PutItem (eventual consistency) unless v2 changed it (it did not).
