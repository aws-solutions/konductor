# Account archive and retention rules

An account archive contains the current workspace membership view and the invitation history needed for an audit. Invitation history includes the creation time, inviter role, recipient address in masked form, and terminal state.

When a member is removed from a workspace, pending invitations addressed to that member are revoked in the membership transaction. Subsequent account exports must omit invitations that belong to a removed member. Completed invitation events remain in the audit store for 400 days, subject to the masked-address rule.

The archive service requests an export at a point-in-time cursor. It may retry a page, so export rows need stable identifiers and repeatable ordering.
