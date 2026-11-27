# card-batch

The nightly card batch, being ported step by step from the legacy job stream. Each legacy step becomes one module
under `src/jobs/` with a pure `run(input)` function; the scheduler (not in this repository) reads the inputs and
writes the outputs. Each step's behaviour is written down in `docs/jobs/<step>.md`, taken from the legacy listings.
No dependencies; Node 22 or later. Money is always an integer number of cents.

Run the tests with `npm test` (`node --test test/*.test.js`).
