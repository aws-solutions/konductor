# Search mapping incident summary

_Incident date: 2024-10-18. Audience: service owners._

A release added a `keyword` multi-field to the product title and changed the analyzer on a category field. The index accepted the new mapping, so the deploy and basic health check were green. Over the next hour, exact-title queries stopped matching the expected products for two locales. The result quality monitor detected the change after the first customer report.

The team restored the previous application version but could not change the existing field mapping in place. They created a replacement index with the prior mapping, copied source documents, and moved the read alias back. The recovery took 47 minutes. During the recovery, search availability stayed above the monthly target, but the empty-result control query crossed its page threshold for 18 minutes.

Follow-up actions were to keep mapping changes in versioned design documents, record a fixed control-query result set before a search release, and ensure the search owner has an alias operation runbook. The incident did not involve data loss or unauthorized access.
