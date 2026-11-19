# Architecture

The migration runner reads a page from the legacy store, maps each row, writes the page to the new store, and records progress. The capture reader handles changes after the snapshot. Both paths share the field mapper and conflict resolver.

The file store is a development adapter. It writes JSON arrays and newline-delimited records, while production adapters implement the same small interfaces. The CLI assembles those components and prints a compact operation result.
