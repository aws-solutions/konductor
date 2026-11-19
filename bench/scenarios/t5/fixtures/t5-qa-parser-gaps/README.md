# Tide Config

Tide Config is a small configuration format for command-line tools. It has
quoted strings, booleans, numbers with units, arrays, and dotted sections.

```ini
name = "harbor"
timeout = 250ms
tags = ["edge", "safe"]

[server.http]
port = 8080
```

The parser is available from `src/index.js`, and `node src/cli.js file.conf`
prints a normalized version of a file. The project has no runtime dependencies.
See `docs/format.md` for the grammar and `docs/api.md` for the JavaScript API.
