# Contributing to shelf

- Each command lives in `src/commands/<command>.js` and is registered by name in `src/commands/index.js`.
- Every change comes with a test under `test/` that fails without it.
- Output text is part of the interface: scripts read it, so match the ticket's wording exactly.
