# Contacts API

## Contact

| field      | type           | notes                                            |
|------------|----------------|--------------------------------------------------|
| `id`       | string         | `c1`, `c2`, ... assigned in creation order       |
| `displayName` | string      | required, 1-80 characters after trimming         |
| `fullName` | string         | deprecated alias of `displayName`, same value    |
| `email`    | string         | required, must contain `@`, stored lower case    |
| `phone`    | string or null | optional                                         |
| `locale`   | string         | `en` by default; `xx` or `xx-XX` (`pt-BR`)       |

On input `fullName` is accepted in place of `displayName`; if both are given and differ the call fails with
a `ValidationError` on `fullName`.

Objects returned by the service are copies: changing one never changes stored data.

## Service

- `create(input)` returns the new contact. A failed create does not use up an id.
- `get(id)` returns the contact or `null`.
- `update(id, patch)` changes the given fields and returns the contact, or `null` if there is no such id.
- `list({ sort })` sorts by `displayName` (default; `fullName` is accepted as an alias), `email` or `id`. Any other key fails with a `ValidationError` on `sort`. Name and email sorts ignore case; equal
  values keep creation order.
- `search(q)` matches contacts whose name or email contains `q`, ignoring case. A blank `q` matches nothing.
  Results are in creation order. Search always reflects the current data.
- `exportCsv({ version })` returns the CSV text. `version` is 1 (default) or 2.

Failures throw `ValidationError` with a `field` property. Clients match on `field`, so a missing or invalid
name is always reported with field `fullName`, whatever the input used.

## CSV

Version 1 header `id,fullName,email,phone`; version 2 header `id,displayName,email,phone,locale`. One row per contact in `list()` order, rows end with `\n`. A field that
contains a comma, a double quote or a line break is wrapped in double quotes, with inner quotes doubled.
The header is read by downstream tools; do not change it for existing callers.

## Handler: `handleRequest(service, { method, path, query, body })`

| request                      | success                         | failure                                         |
|------------------------------|---------------------------------|-------------------------------------------------|
| `POST /contacts`             | `201 { ...contact }`            | `400 { error: { field, message } }`             |
| `GET /contacts/:id`          | `200 { ...contact }`            | `404 { error: { message: 'not found' } }`       |
| `PATCH /contacts/:id`        | `200 { ...contact }`            | `404` as above, `400` as above                  |
| `GET /contacts?q=&sort=`     | `200 { contacts: [...] }`       | `400` for a bad sort                            |
| `GET /contacts/export?version=` | `200` with CSV text as `body` | `400` for a version other than 1 or 2         |
