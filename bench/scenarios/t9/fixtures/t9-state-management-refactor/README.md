# Cornerstone Board

Cornerstone is the small task board used by the studio team to keep handoffs visible. This package contains the browser-independent part of the application: board state, keyboard commands, drag payloads, persistence records, and view-model helpers.

The project intentionally has no runtime dependencies. Consumers require the modules from `src/`, while the test suite exercises the same functions without a browser.

## Development

Use Node 24 or newer. Run `npm test` to execute the checks, or `npm run check` to syntax-check the board module.

The board has three built-in columns: Inbox, In progress, and Done. Cards are plain objects so a browser adapter can render them in any framework.
