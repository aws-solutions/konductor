# ISSUE-412: Retrying a report sends duplicate email
Reporter: Gina Park
Date: 2026-04-15

When a report email times out, retrying sends two messages to the recipient. Waiting for the first request to finish avoids the duplicate.

Environment: Chrome 124 on macOS 14; release 1.8.1

Comments:
- I can avoid it by not clicking retry until the status changes.

Reactions: 9
