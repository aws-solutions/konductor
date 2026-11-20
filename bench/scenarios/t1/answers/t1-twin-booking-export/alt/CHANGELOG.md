# Changelog

## Unreleased

- Added `GET /api/v1/bookings/export`, which returns RFC 4180 CSV with optional inclusive `from` and `to` date filters.
- Rejected malformed and impossible export date bounds with the `bad_request` error code.

## 1.4.0 - 2025-02-10

- Added booking date validation.
- Added readiness reporting for deployments.
- Improved error messages for malformed JSON.

## 1.3.0 - 2024-11-18

- Added delete-booking support.
- Kept the sample data set small for local development.

## 1.2.0 - 2024-08-02

- Returned stable error codes from the HTTP API.
