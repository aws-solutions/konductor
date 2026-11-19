# Existing API notes

The pilot exposes `POST /readings` and accepts one reading at a time. It returns a single success object, so callers cannot distinguish a device validation failure from a transient storage failure when they send several readings.

The pilot's deployment notes refer to a 1 MiB body ceiling. That pilot setting is superseded by the production gateway setting documented in `ingest-requirements.md`; it is retained here only to explain why the current endpoint cannot be copied unchanged.
