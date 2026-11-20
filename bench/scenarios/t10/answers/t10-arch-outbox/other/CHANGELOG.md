# Changelog

## 2.2.0 - 2024-10-04

- Added a compact health endpoint.

## 2.3.0 - 2024-12-10

- Added order lookup by external reference.

## 2.3.1 - 2025-01-29

- Improved malformed request responses.

## 2.4.0 - 2025-02-14

- Added payment status validation for captured and declined payments.

## Unreleased

- Payment status changes now queue a durable event in the same write; a background publisher sends each one with a stable x-event-id, retries with backoff and keeps failures as dead letters.
