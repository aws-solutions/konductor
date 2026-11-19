# Operations notes

The JSON store is intended for a single process and modest fixture data. Writes use a temporary file and rename so a killed process does not leave a partial document.

Run `npm test` before changing sample data. The CI job checks both tests and the five expected data files. Logs include a request id but never include request bodies.
