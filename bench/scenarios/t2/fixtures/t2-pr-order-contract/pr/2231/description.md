# PR 2231: tidy order response and status values

## What changed

This update makes the order JSON easier for the current mobile clients to consume. It gives responses a small version marker, exposes the currency beside the formatted total, simplifies status presentation, and standardizes queue metadata. The order route also gets a compact listing helper and the service gains a diagnostic customer lookup for support work.

## Why now

The app rollout is moving through its next release, and support needs a quick way to inspect a customer record while checking delivery changes. Keeping these adjustments together makes the response and queue shapes consistent for the next deployment.

## How it was tested

- `node --test`
- Response and queue assertions were updated for the new shapes.
- The order route tests cover listing, updates, missing records, and required update fields.
