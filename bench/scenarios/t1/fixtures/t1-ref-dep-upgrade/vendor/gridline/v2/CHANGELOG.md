# Gridline 2 changelog

## 2.0.0

- Renamed `formatTable` to `renderTable`.
- Removed the `quickTable` shortcut; use `renderTable` with `compact: true`.
- Table numbers are plain by default instead of grouped to two decimal places.
- CSV output now always ends with a newline and quotes values containing commas, quotes, or line breaks.
- Column descriptors use `label` for the heading.
