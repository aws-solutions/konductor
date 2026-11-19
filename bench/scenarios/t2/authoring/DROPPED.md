# Dropped T2 tasks

| Id | Date | Why | Replaced by |
| --- | --- | --- | --- |
| t2-sec-pr-webhooks | 2026-11-19 | Author deepseek-3.2. The first version left out the brief's main problem (an unchecked outbound callback) and had 19 files; the lead's fix round added it, but the re-review (minimax-m2.5) found key line numbers that no longer matched the code, an item that was not a real problem (a log that prints a 16-character prefix), and a code comment that named the planted problem. The one fix round was used, so the task was dropped. | t2-sec-pr-webhook-relay |
