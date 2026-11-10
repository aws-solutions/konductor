# Shop API v2.3 requirements

## Feature 1: Authentication
- AC-1.1: A user with valid email and password receives a session token.
- AC-1.2: After 5 consecutive failed logins the account is locked for 15 minutes.
- AC-1.3: Requesting a password reset for a registered email sends a reset email with a single-use link.
- AC-1.4: A reset token older than 30 minutes is rejected with HTTP 410.

## Feature 2: Checkout
- AC-2.1: A successful checkout charges the card through Stripe and stores the order.
- AC-2.2: A declined card returns HTTP 402 with a user-readable message and no order is stored.
- AC-2.3: The customer receives a receipt email that renders correctly in Gmail and Outlook.

## Non-functional
- NFR-1: p99 checkout latency under 800 ms at 50 requests per second.
- NFR-2: Passwords are stored as bcrypt hashes.
