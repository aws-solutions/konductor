# RelayRoom platform folder

RelayRoom is the internal name for the realtime collaboration service. This folder is the working set used by the platform team when reviewing production changes. It contains service notes, operational data, deployment records, and a few retained team notes.

The production fleet has forty Linux hosts across three zones. Clients keep websocket sessions open while they edit shared rooms. The platform owns the edge gateway, session router, presence workers, and collaboration API; the database team owns the shared database.

The data covers 19 August 2025 unless a document says otherwise. Timestamps in logs are UTC. Host names and identifiers are synthetic.

The scripts directory contains small operator helpers. They do not install dependencies or call external systems.
