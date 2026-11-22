# Product brief: notification preferences

## Why now

Customers currently receive account and product messages through email and push notification. They can change some settings in separate product screens, and the settings do not agree in every path. The Account Settings team wants one place where a customer can choose which categories may be sent to each channel.

## Requested outcome

Deliver a single account-level preference record for the first release. The record covers four categories: account activity, billing, product updates, and recommendations. A customer can enable or disable email and push independently for each category. Account activity and billing remain enabled by default because they contain service and payment notices.

The first release needs to make a saved change visible to the message sender within 60 seconds for at least 99 percent of changes. The service should support 10 million accounts at launch and an expected 25 percent increase in accounts over the following 12 months. The product team will use a small controlled rollout before enabling the feature for all accounts.

## Out of scope for the first release

The brief does not ask for per-message rules, customer-written conditions, quiet hours, channel ranking, tenant-specific policy, or a visual rule editor. It does not change message templates, delivery providers, or the existing unsubscribe mechanism for legally required mail. Those topics may be considered after usage data is available.

## Experience and ownership

The settings screen should show the current state and confirm a saved change. Existing senders should be able to read the effective preference without learning the storage details. Account Settings owns the screen, Notifications Platform owns the preference API, and Messaging owns sender integration. The teams will agree on an event contract before rollout.