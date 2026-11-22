# Workspace service architecture

The workspace service owns workspace membership, pending invitations, and the invitation export used by the account archive flow. Its API is a Go service behind the edge proxy. PostgreSQL stores `workspaces`, `members`, and `workspace_invites`; the worker process reads `outbox_events` and sends email through the Mailpond provider.

The web client calls the API through the edge proxy. The proxy authenticates a session and adds `actor_id` and `workspace_id` claims. The API still checks membership and role for every workspace operation. Workspace owners and administrators can invite; regular members can view their own pending invitation status but cannot list all invitations.

The outbox worker uses a lease on each event. A leased event is retried with exponential delay when the provider returns a transient error. A successful provider response records the provider message id. Events stay in the outbox table until the worker records a terminal state. The account archive service reads a versioned export query from the workspace service rather than querying the database directly.

Invitation tokens are stored as SHA-256 digests. The raw value is returned only in the creation response and is placed in the link sent to the invitee. Application request logs include the route and actor but not request bodies.
