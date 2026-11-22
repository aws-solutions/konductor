# Release notes

## Current

The catalog service is moving its payload naming toward shorter field names. Product events remain version 1 while the search team finishes its next replay window.

## Operations

Use `node --test` before a release. The fixture store is writable during local smoke runs, so restore `data/products.json` before committing after a manual create request.
