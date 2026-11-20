# ci-two-zones (A6), Bo

`.ci/pipeline.yml` runs the test step as a matrix over `TZ`: UTC and Europe/Berlin. CI file only.
Started from the code after help-text, config-json and currency-model were merged.

Ran `node --test test/*.test.js` locally under both zones: 4 passing, 0 failing each time.
