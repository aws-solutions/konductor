# Support ticket service: data access

## Entities

- Ticket: id, customerId, subject, status (open, pending, solved, closed), priority (1 to 4), assignedAgent (optional), externalRef (optional, unique across all tickets), createdAt, updatedAt. About 3 KB each.
- Comment: ticketId, commentId, author, body (up to 2 KB), createdAt. A ticket has 40 comments on average and up to 10,000.
- AuditEntry: ticketId, at, actor, action. Written on every status change.

## Volumes

- 400 million tickets, about 1.2 TB, growing 3 percent a month.
- 80 percent of reads and writes touch tickets created in the last 30 days.
- The largest customer has 200,000 tickets. Most customers have under 100.
- Status has four values, spread roughly evenly.

## Access patterns

| ID | Pattern | Rate | Notes |
|----|---------|------|-------|
| AP1 | Get one ticket by id | 2,000 reads/s | p99 under 10 ms |
| AP2 | List a customer's tickets, newest first, 25 per page | 500 reads/s | the 200,000-ticket customer calls this too |
| AP3 | List the open tickets assigned to one agent, highest priority first, then oldest first | 300 reads/s | an agent has up to 400 open tickets |
| AP4 | Get a ticket with its 50 latest comments, then page back through older ones | 400 reads/s | |
| AP5 | Find the ticket for an external reference number | 100 reads/s | at most one match |
| AP6 | Dashboard: number of tickets in each status across all customers | once a minute | a count that is a few minutes old is fine |
| AP7 | Close a ticket and record the audit entry so that both happen or neither does | 50 writes/s | refuse if the ticket is already closed |

Creating tickets (150 writes/s), adding comments (600 writes/s) and updating a ticket (200 writes/s) also happen all day.

## Constraints

- The team runs on a managed key-value database (DynamoDB). No other database is available for the primary data.
- Reads must be strongly consistent for AP1 and AP4 so an agent sees a comment they just added.
- Tickets of closed customers are kept for 7 years but are rarely read after 90 days.
