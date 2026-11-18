# Spike brief: faster contact dedupe

The nightly import calls `dedupe` from `src/dedupe.js` on each uploaded file. Files are getting bigger: the
largest customer now uploads 50,000 contacts, and the import step has a budget of 300 ms on one core for dedupe.

On a laptop the current `dedupe` takes about 0.4 s for 5,000 contacts, and the time grows with the square of the
input, so 50,000 contacts take minutes. Do not run it at 50,000.

Question for the spike: can another approach dedupe 50,000 contacts in under 300 ms with exactly the same output as
`dedupe` (same contacts kept, same order)? If yes, we change the import next sprint. If no, we split files.

Use `makeContacts(n, seed)` from `src/contacts.js` for test data. The spike is throwaway: it must not change `src/`.
