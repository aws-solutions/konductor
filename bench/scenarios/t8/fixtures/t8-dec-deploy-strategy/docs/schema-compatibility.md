# Shared database compatibility note

The collaboration API and the room-index worker use one shared PostgreSQL database. During a release, the database schema must support **two application versions at once**. Additive changes are safe for the overlap; a column rename or destructive type change needs a separate migration window.

The last approved migration used an additive nullable column and was followed by a cleanup release. The database team does not provide a transaction rollback for application binaries.
