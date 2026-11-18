# Spike: keyed contact dedupe

Throwaway spike, not for production.

## Question

Can another approach dedupe 50,000 contacts fast enough, with the same output as `dedupe`?

## Results

Run `node spike/run.js`. The keyed approach was faster, in ms. Email normalization matters.

## Recommendation

Use a Map or Set keyed by email.
