# Self-serve notification preferences: design summary

Goal: customers control which notifications they get without contacting support.

Scope:
- Preferences API: GET/PUT /preferences (DynamoDB table, validation, tests).
- Preferences UI page in the settings area with toggles per channel (email, SMS, push).
- Delivery pipeline reads preferences before sending (change in sender Lambda).
- Migration: default preferences for 1.2M existing users.
- Observability: dashboard and alarms for preference read failures.
