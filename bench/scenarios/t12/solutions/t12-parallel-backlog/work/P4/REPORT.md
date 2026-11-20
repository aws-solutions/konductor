# P4: A3 help text and A6 CI (Bo)

- A3: `src/cli.js` help text now prints `--since` (the flag the code reads) instead of `--from`.
- A6: `.ci/pipeline.yml` runs the suite twice, with `TZ=UTC` and with `TZ=Europe/Berlin`.

Built on the original code (first in the merge order).

Check: `node --test test/*.test.js` printed pass 1, fail 0.
