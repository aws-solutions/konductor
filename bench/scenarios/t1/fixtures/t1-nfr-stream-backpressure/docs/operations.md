# Operations notes

The process is designed for a single local worker. The `PORT` environment variable controls its listening port. Logs are concise and do not include record contents.

The bundled data is deliberately modest. Larger installations should replace the data source at the application boundary rather than changing the HTTP handlers.
