# Storage notes

The storage adapter is given a directory owned by the service account. Callers provide a single file name, not a filesystem path. The adapter returns text for the archive worker and translates a missing file into a 404 response.
