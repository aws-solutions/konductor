# Storage layout

```
storage/
  index.json   list of documents; the only record of ownership
  blobs/       one file per document, named in index.json
  archive/     cold data kept for finance retention; deliberately not in index.json
  tmp/         partial uploads written by the web front end
```

- A document exists once it has an entry in `index.json`. The front end writes the file first and the
  entry second, so a file can briefly exist without an entry.
- `archive/` is managed by finance. Nothing in this repository reads or writes it.
- `tmp/` holds `*.part` files for uploads in progress or abandoned.
- The disk is backed up weekly, on Sunday night.
