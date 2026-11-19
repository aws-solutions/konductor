# Session schema compatibility

The new `wallet_session.region_code` column is nullable during expansion. The deployed reader can ignore it. Older code cannot read a row where the new writer has made the column mandatory, so the migration must expand first and the code that writes the column must be last among schema-sensitive changes.

Data Platform will verify reader compatibility and replication lag before any writer flag is enabled.
