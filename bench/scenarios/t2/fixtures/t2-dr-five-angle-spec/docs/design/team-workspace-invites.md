# Team workspace invitations

**Status:** Ready for implementation  
**Authors:** Workspace Foundations  
**Last updated:** 2025-02-14  
**Audience:** Workspace API, web client, email platform, and account archive teams

## 1. Summary

This design adds invitations to the shared workspace experience. An owner or administrator can enter one address in the workspace settings page, send an invitation, and see the invitation in the workspace's pending list. The recipient follows a link, signs in or creates an account, and joins the workspace. Administrators can revoke a pending invitation and can export invitation history as part of an account archive.

The first release is deliberately small. It uses the existing workspace API, PostgreSQL transaction boundaries, outbox worker, and Mailpond email provider. It does not introduce a separate invitation service or a second identity system. The web client owns form presentation while the API remains the source of truth for authorization and state transitions.

The design is ready for implementation because it reuses paths that already carry workspace identity, keeps the new tables narrow, and gives each team a clear ownership boundary. Later work can add bulk invitations and richer reporting without changing the acceptance flow.

## 2. Goals and boundaries

### 2.1 Goals

The feature should let a permitted workspace administrator invite a person in less than a minute. It should make the pending state visible, allow an administrator to cancel an invitation, and make acceptance work for both an existing account and a new account. An invitation must be tied to one workspace and one recipient address. The service should retain enough history for the account archive without retaining raw bearer credentials.

The first release supports one address per request. The web screen will prevent accidental double submission while the API remains safe if a client retries. The feature will use the service's existing session cookie and role checks. Email delivery is asynchronous so a slow provider does not hold an API request open.

### 2.2 Out of scope

Bulk CSV upload, invitations from mobile clients, changing a recipient after creation, and custom email templates are outside this release. We will not add a new notification preference center. The email platform team owns provider credentials and sender reputation. The account archive team owns the archive download, while Workspace Foundations owns the versioned export rows.

## 3. User and service flows

### 3.1 Create and send

The web client sends `POST /v1/workspaces/{workspaceId}/invites` with the entered email address. The API normalizes the address for comparison, checks that the actor is an owner or administrator, and inserts a pending row. The insert and an `invite.created` outbox event are committed in one database transaction. The response contains the invitation id, normalized address, and `pending` state; it does not contain the link.

The outbox worker builds the link from the public web origin, workspace id, invitation id, and a random token. It stores only the SHA-256 token digest on the invitation row. The worker sends a message to the recipient, a confirmation to the inviter, and a notice to the workspace administrators. Each message contains the same acceptance link and a short workspace name. The API returns before any of these messages are accepted by the provider.

A retry uses the same outbox event and provider idempotency key. If the provider accepts the message but the worker loses its connection before recording the response, the same key lets the provider return the original message id. The worker records that id and moves the event to its terminal state. A provider rejection is terminal after the normal retry limit and remains visible in the worker dashboard.

### 3.2 Invitation link lifetime

An invitation link remains usable while its invitation row is pending. The row is marked accepted after the recipient completes sign-in and the membership insert succeeds. The link is also left associated with the invitation after acceptance so that a recipient who opens it again sees the workspace rather than a confusing missing-page response. An administrator can revoke a pending row from the settings page, which prevents later acceptance.

The token is a random 32-byte value encoded for use in a URL. The acceptance endpoint hashes the supplied value, finds the invitation by digest and invitation id, and checks the invitation's workspace. It then checks the signed-in account's email against the normalized recipient address. These checks happen in a transaction with the membership insert. If the account is already a member, the endpoint returns the existing membership and does not add a duplicate row.

Keeping accepted links useful avoids support tickets from people who reopen an old browser tab. It also means the email does not need a second confirmation link. The acceptance page can show whether the workspace is active and send the user to the workspace home after the membership check.

### 3.3 Pending invitation list

The settings page calls `GET /v1/workspaces/{workspaceId}/invites` when the Invitations tab opens. The API checks the actor's workspace role, selects all pending invitations for that workspace, sorts by `created_at DESC`, and returns the complete array in one response. Each row includes invitation id, masked address, inviter display name, creation time, and current state. The client renders the array in a compact table with a revoke button.

The endpoint does not use a cursor or page-size parameter. The product team expects most workspaces to have only a few pending invitations, and returning one complete list keeps the browser state simple. The API response is still bounded by the maximum request body size at the edge, so the service does not need a separate list limit for this release. A later bulk-invite project can add paging if the table grows.

The list query uses the existing composite index on `(workspace_id, state, created_at)`. The API serializes timestamps in RFC 3339 and uses the same envelope as the members endpoint. Empty results are a successful response with an empty array. The web client displays the last fetch time in the tab header for support screenshots.

### 3.4 Email worker operation

The email worker polls the outbox every 15 seconds and takes leases for events that are ready. It retries transient provider errors up to eight times, with exponential delay capped at ten minutes. Permanent address failures are recorded as terminal and do not block other workspace events. A worker restart releases an expired lease so another worker can continue.

Operations will use the existing workspace dashboard, which shows queue depth, queue age, attempts, provider response class, and terminal outcomes. The dashboard is sufficient for the first release because the email path already has a daily review by the support rotation. We will add a panel for invitation events and a link from the Workspace API service page. No new paging or alert rule is needed for this worker.

The API response does not promise delivery. The settings page shows `sending`, `sent`, or `failed` based on the outbox terminal state and refreshes the status when the page opens. A failed event can be retried by an administrator from the row action after the provider issue is resolved. Manual retry creates a new attempt for the same event rather than a second invitation.

### 3.5 Message fanout and budget

Every successful invitation creates three transactional messages: one to the recipient, one confirmation to the inviter, and one notice to workspace administrators. All three are useful during launch because the inviter needs confirmation and administrators need visibility into new access. The messages share the same provider template family and are sent independently so a bad address does not suppress the other messages.

The current estimate is 420,000 invitations per month, growing to 610,000 after three months. At $0.002 per provider message, the three-message design costs $2,520 now and $3,660 at the three-month estimate. Both figures fit within the $5,000 monthly workspace email cap. The estimate excludes password-reset and billing emails, which have their own budgets. The dashboard will report invitation messages separately so Finance can compare actual volume with this estimate.

A confirmation is sent even when the inviter's browser closes before the API response. The administrator notice includes workspace name, inviter, masked recipient, and creation time, but not the link. A later preference project can combine notices into a digest. For now, separate messages make the first release easy to trace in provider logs.

### 3.6 Invite form validation

The form has a labelled email control and a submit button. The client validates the basic address shape before sending the request and the API validates the normalized value again. A duplicate pending invitation returns a conflict with a stable error code. A forbidden role returns a permission error without revealing whether the address is already known to the workspace.

Validation feedback uses a red border and a red inline icon beside the email field. A valid field uses a green border after the server responds. The submit button is disabled while the request is in flight and becomes available again after a response. The client preserves the typed address when a validation response arrives so the user can correct it without starting over.

The API returns an error object with `code`, `message`, and optional `field` values. The web client maps `invalid_email` and `duplicate_invite` to the email control and maps other errors to a notification at the top of the form. The design uses the existing form components and their colour tokens so the new screen matches workspace settings.

### 3.7 Archive export behavior

The workspace export adds an `invites` collection beside members and audit events. Each invite row contains a stable invitation id, masked recipient, inviter id, creation time, accepted time when present, and terminal state. The export query uses the same workspace snapshot cursor as the member collection, and rows are ordered by invitation id to make retries repeatable.

The export includes pending, accepted, and revoked invitations so an account owner can see the complete history of access requests. A member removal changes the membership state but does not rewrite historical invitation rows. Keeping the rows makes the archive internally consistent with past activity and avoids losing evidence during an access review. The archive service will apply its normal encryption and download expiry to the resulting file.

The new collection is behind export schema version 3. Existing consumers continue to receive version 2 until they opt into the new field. The API rejects an unknown export version rather than silently returning a partial shape. Workspace Foundations will publish the field definitions with the implementation ticket.

## 4. Data model and authorization

### 4.1 Invitation record

The `workspace_invites` table has `id`, `workspace_id`, normalized recipient address, token digest, inviter id, state, created timestamp, accepted timestamp, revoked timestamp, and provider message references. State values are `pending`, `accepted`, `revoked`, and `delivery_failed`. A unique constraint on `(workspace_id, normalized_recipient, state)` prevents two pending invitations to the same address. Terminal rows remain available to the export query.

The token digest is compared in constant-time application code after the candidate row is selected. The raw token is assembled only in the worker process and is not saved in the database. Foreign keys connect workspace and inviter records. Deleting a workspace cascades its invitations after the normal archive hold has cleared.

### 4.2 Permission checks

Create, list, and revoke handlers load the workspace from the route id and compare it with the authenticated actor's workspace claim. Owners and administrators can create and revoke. Owners, administrators, and members can read the narrow status endpoint, but only owners and administrators can list all invitations. Acceptance is a separate route and requires the token, workspace association, and recipient match.

The revoke operation locks the invitation row, checks that it is still pending, changes its state, and commits. If acceptance wins the race, revoke returns the current accepted state. If revoke wins, the acceptance transaction cannot insert membership from that row. These responses are safe to retry because state transitions are conditional.

## 5. API and client contract

### 5.1 Endpoints

The create, list, revoke, and accept routes use the existing JSON error envelope. Create returns `201` with an invitation resource. List returns `200` with `items` and `fetched_at`. Revoke returns `200` with the new state. Acceptance redirects a browser to the workspace home or to sign-in with a short-lived continuation value.

Rate limits use the existing workspace API buckets. Create is limited by actor and workspace; list is limited by actor and route. The edge proxy rejects malformed JSON before it reaches the service. The API includes a request id in errors, and the worker copies the outbox event id into structured logs for support tracing.

### 5.2 Compatibility

The web client and API ship behind the `workspace_invites` feature flag. When the flag is off, the settings route is hidden and the API returns a feature-disabled error. Existing workspaces have no invitation rows, so the migration can create the table before application code starts writing it. The table migration is additive and can run during normal deploys.

The API contract is versioned with the workspace service. Client changes land after the server and use the empty-list response during the rollout window. Removing the feature flag does not delete rows; a later data lifecycle task will handle old records.

## 6. Rollout and verification

### 6.1 Delivery order

Database migration, API handlers, worker template changes, and web settings controls will land behind the feature flag. The email platform team will provision the sender and verify the three template variants in a sandbox. The archive team will consume export version 3 after a fixture archive has been reviewed. Product will enable the flag for internal workspaces first and then for ten percent of customer workspaces.

The rollout owner will compare invitation creation success, acceptance success, provider terminal failures, and API latency with the service dashboard. The team will pause the rollout if the API error rate rises above the existing service target or if provider rejection rates change materially from the baseline. A flag rollback hides new controls and stops new invitations; existing pending rows remain in the database for later handling.

### 6.2 Verification cases

The implementation test set covers an authorized create, a forbidden create, duplicate pending addresses, revoke-versus-accept races, provider retries, terminal provider errors, export schema versions, and a new account acceptance. The web test set covers keyboard tab order, invalid address feedback, a server conflict, and a failed request after the user has typed an address.

Load checks will use 10,000 workspaces with a distribution of pending rows based on the current production snapshot. The API team will compare p95 create and list latency against the target file. The worker team will run a provider timeout simulation and inspect the terminal state dashboard. The archive team will retry an export page and compare row identifiers between attempts.

## 7. Decisions and open follow-up

We chose an outbox-backed worker rather than synchronous email so the invitation API stays within its latency target. We chose a single invitation table rather than a separate access-request model because the membership transaction already owns workspace association. We chose server-side address normalization so API and web clients cannot create visually duplicate pending rows.

Bulk invite, administrator digest preferences, a richer delivery history, and invitation analytics are follow-up work. The first release should stay focused on a reliable one-address flow and the existing workspace conventions. With the migration, API, client, worker, and archive contracts above, the team can begin implementation without another design change.
