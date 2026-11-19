# Price lists

A price list belongs to one tenant. List identifiers are part of the JSON filename and default to `retail` at the HTTP boundary.

Bulk replacement is used by the nightly import. It writes the complete array supplied by the importer. A single-price patch is used by the support console and preserves fields not included in the patch.
