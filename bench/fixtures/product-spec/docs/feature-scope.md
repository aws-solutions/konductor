# Feature scope: hold-requests

Feature name: `hold-requests`

In scope stories: US-1, US-2, US-3, US-4, US-5.
Out of scope: US-6 (weekly report), planned for a later feature.

Requirements covered: REQ-1 to REQ-9.

Key components:
- HoldService: places, cancels and expires holds.
- HoldQueueStore: persists holds and their order per title.
- Notifier: sends the "your copy is ready" email.

Dependencies:
- Catalog service: tells us whether a title has an available copy and announces returns.
- Member service: identity and email address.
