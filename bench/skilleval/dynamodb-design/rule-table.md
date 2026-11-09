# Rules: dynamodb-design

Bucket is the rubric bucket for items tied to the rule. Status shows the owner decision when there is one.

| Rule | Bucket | Status | Worth votes | Style votes | Rule text |
| --- | --- | --- | --- | --- | --- |
| R01 | value | kept | 3 of 3 | 0 | The answer must recommend using Amazon OpenSearch or CloudSearch instead of DynamoDB for full-text search requirements. |
| R02 | value | kept | 3 of 3 | 0 | The answer must advise against using Scan operations in production code and explain that it is an anti-pattern. |
| R03 | value | kept | 3 of 3 | 0 | The answer must recommend storing large binary files such as images, videos, and PDFs in S3 instead of DynamoDB. |
| R04 | value | kept | 3 of 3 | 0 | The answer must include a disclaimer stating that performance and cost estimates need validation through load testing and production monitoring. |
| R05 | value | kept | 3 of 3 | 0 | The answer must explain why a specific attribute was chosen as the partition key, including its distribution and access pattern alignment. |
| R06 | value | kept | 3 of 3 | 0 | The answer must explain why a specific sort key pattern was chosen, including its range query support and hierarchical data needs. |
| R07 | value | kept | 3 of 3 | 0 | The answer must state that performance estimates are theoretical and require validation through load testing with production-like data volumes. |
| R08 | value | kept | 3 of 3 | 0 | The answer must warn that cost estimates are theoretical and may vary significantly, recommending the use of AWS Cost Explorer and billing alarms. |
| R09 | value | kept | 3 of 3 | 0 | The answer must explain that GSI throttling blocks all writes to the base table. |
| R10 | value | kept | 3 of 3 | 0 | The answer must flag any use of Scan operations in production code as a critical red flag. |
| R11 | value | kept | 3 of 3 | 0 | The answer must recommend starting the design process by listing all access patterns before defining the table schema. |
| R12 | value | kept | 3 of 3 | 0 | The answer must recommend defaulting to Global Secondary Indexes (GSI) over Local Secondary Indexes (LSI) for most use cases. |
