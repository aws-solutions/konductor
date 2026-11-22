# Current catalogue search

## Request path

The storefront sends `q`, `locale`, `department`, and optional facet values to the Catalogue API. The API normalizes whitespace, checks the locale against the catalogue, and adds a department predicate when one is present. It queries PostgreSQL through the repository layer. Search results are ordered by `title_sort` and then by product id. Availability and price are read from the catalogue tables in the same transaction as the result query.

The current title lookup uses a left-anchored pattern. In simplified form, the repository sends `title LIKE :prefix || '%'` after applying the locale and department predicates. The description field is not searched. Empty queries are rejected by the API. A request may include one prefix of up to 64 UTF-8 characters.

## Data shape

The primary catalogue has 18.4 million active product rows across four storefronts. A product can have one localized title per supported locale. The title index is a PostgreSQL B-tree on `(locale, department_id, title_sort)`. The index was added after the February 2024 query review. The database runs with three read replicas, and the Catalogue API uses a read-only connection for search.

The search response includes product id, localized title, current price, stock state, and a small set of facets. Prices and stock are authoritative in PostgreSQL. Search is allowed to return a product that has changed in the last few seconds, but the response must never show price or stock values read from a separate stale document.

## Request examples

The following examples are taken from request logs after removal of query text:

| Case | locale | department | shape |
| --- | --- | --- | --- |
| Prefix title | en-GB | books | `title LIKE :prefix || '%'` |
| Prefix title | fr-FR | home | `title LIKE :prefix || '%'` |
| Prefix with facet | de-DE | electronics | prefix plus `brand_id = :brand` |
| Empty search | en-GB | any | rejected with HTTP 400 |

There is no product search endpoint that scans an arbitrary substring in the title or description. Administrative export screens use a separate reporting query and are outside the storefront path.
