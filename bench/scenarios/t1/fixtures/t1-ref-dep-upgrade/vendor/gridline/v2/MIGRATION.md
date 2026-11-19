# Migrating from Gridline 1

Replace `formatTable(rows, { columns })` with `renderTable(rows, { columns })`. The old quick table helper has no direct replacement; pass `compact: true` to the renderer.

The renderer now uses plain numeric values by default. Pass `numberStyle: "grouped"` when a legacy display is required.

CSV callers should use `renderCsv(rows, columns)`. The options object is no longer accepted by the CSV helper.
