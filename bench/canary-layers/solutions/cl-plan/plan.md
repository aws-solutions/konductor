# Plan

1. Migrate the user table to the new schema. Done when the migration runs cleanly on a copy of production data.
2. Update the API clients to use the new fields. Depends on step 1. Done when the client tests pass.
3. Backfill historical rows. Depends on step 1. Done when row counts match.
4. Remove the old columns once nothing reads them. Depends on steps 2 and 3. Done when a search finds no reader.
