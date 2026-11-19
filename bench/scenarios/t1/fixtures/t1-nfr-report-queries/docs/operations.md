# Operations notes

The scheduled job writes a fresh file before handing it to the downstream importer. Keep the SQLite database on local storage while a report is running. The loader is intended for examples and test data, not for production imports.
