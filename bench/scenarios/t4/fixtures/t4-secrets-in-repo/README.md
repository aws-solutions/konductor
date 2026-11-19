# Paper Lantern Notifications

Paper Lantern is a small CommonJS service that accepts notification jobs and sends SMS messages. It also exposes a health endpoint and verifies signed webhook events.

## Run locally

The service uses Node.js 24 and has no runtime dependencies. Copy `.env.example` to `.env`, fill in values for a local provider, and run `npm start`. The example values are intentionally non-working placeholders.

Run the test suite with `npm test`.

## Layout

- `src/` contains the service and provider adapters.
- `config/` contains environment-specific non-secret settings.
- `test/` contains fast unit and integration tests.
- `docs/` contains operational notes and request examples.
