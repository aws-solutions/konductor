# Workspace access standard

Invitation credentials are bearer credentials. A created invitation must have a server-enforced expiration of 48 hours from creation. A successful acceptance consumes the credential, and a second acceptance attempt must not create or restore membership. An administrator may revoke a pending invitation before its expiration.

The acceptance endpoint must check the workspace and invited address attached to the stored invitation. It must not grant access based only on a token string. Token values must not be written to application logs, analytics events, or support exports.

These controls apply to invitations sent by the web application and to invitations created by the API.
