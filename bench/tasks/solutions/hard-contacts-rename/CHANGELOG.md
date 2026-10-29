# Changelog

## Unreleased

- Rename the contact field `fullName` to `displayName`. `fullName` is still accepted on input and still returned as a deprecated alias.
- Add the `locale` field (default `en`).
- Add CSV version 2 (`id,displayName,email,phone,locale`); version 1 output is unchanged.
- Fix `search` not seeing changes made by `update`.
- Fix `list` sorting: name and email sorts ignore case.
- Fix CSV quoting for fields with commas, quotes and line breaks.
- Fix returned contacts being the stored objects; they are copies now.

## 0.9.0

- Add `handleRequest` routes for update and CSV export.

## 0.8.0

- Add `search`.
