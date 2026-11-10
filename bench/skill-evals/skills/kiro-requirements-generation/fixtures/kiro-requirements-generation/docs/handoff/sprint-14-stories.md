# Sprint 14: approved stories (PM handoff)

## Epic: Billing Alerts

### BA-1 Budget threshold email
As a finance admin, I want an email when monthly spend crosses a budget I set, so that I can react before the invoice.

- Given a budget is configured
  When month-to-date spend exceeds it
  Then an email goes to the finance admins
- Given the email provider is down
  Then the alert is retried
- Then each budget alert is sent at most once per threshold per month

### BA-2 Alert thresholds
As a finance admin, I want alerts at 80% and 100% of a budget, so that I get an early warning.

- Given a budget has thresholds configured
  When spend crosses a threshold
  Then an alert is sent for that threshold
- Then thresholds are configurable per account

## Epic: Budget Management

### BM-1 Create and edit budgets
As a finance admin, I want to create, edit and delete monthly budgets per account, so that alerts have something to compare against.

- Given I am a finance admin
  When I save a budget with an amount and an account
  Then the budget is stored
- Given the amount is negative
  Then the save is rejected

### BM-2 Budget history
As a finance lead, I want to see last year's budgets next to actuals, so that I can plan the next year.

- Then a table shows budget vs actual per month for the last 12 months
