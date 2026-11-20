# Partner integration notes

The Ploverline connector imports a week of project planning data at a time. It calls `POST /v1/accounts/:accountId/projects/batch` with a `projects` array and keeps the result for reconciliation. A name that already exists is reported beside the other results so one bad row does not discard good rows.

The connector retries a request after a transport failure. It does not retry individual rows based on a business response. Response rows preserve input order and contain either a created project or an error code. The connector currently sends at most 40 rows per request.

Partners use account IDs from the account export. They do not call internal repository modules.
