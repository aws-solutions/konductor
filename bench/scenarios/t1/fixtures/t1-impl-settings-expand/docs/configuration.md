# Configuration model

The parser accepts `KEY=VALUE` lines, optional `export`, blank lines, and comments. The loader reads files from left to right. A later file wins, and process variables win for keys that the files define.

`SERVICE_NAME`, `PORT`, `LOG_LEVEL`, `DEBUG`, `TIMEOUT_MS`, and `DATABASE_URL` have typed convenience properties on the returned `Settings` object. Other keys remain available through `settings.get(name)` and `settings.raw`.
