# Background: invoice export

## Today

- A nightly batch job (cron, 02:00) writes the invoices of the day to a CSV file on the shared drive. Finance loads the file into the ledger at 06:00.
- The job reads the invoice table directly. On a normal day it takes 70 minutes.
- On the last day of each month there are about four times as many invoices and the job takes close to 4 hours. In March it finished at 06:10 and finance loaded a partial file.
- The reports service, owned by the data team, reads the same CSV every morning at 07:00.

## Constraints

- Finance accepts no missing and no duplicate invoice in the ledger. A reconciliation report runs every Monday.
- The new queue service takes 500 messages a second per topic and keeps messages for 7 days.
- Production deploys happen on Tuesday and Thursday only.
- The team is four people: Dana, Eli, Fran and Gus. Fran is away during the second week of the plan.
- Retry settings are set per service. The invoice service uses 3 retries with a 2 second wait.
