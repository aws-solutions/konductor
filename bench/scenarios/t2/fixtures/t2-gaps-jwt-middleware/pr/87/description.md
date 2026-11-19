# Replace session cookies with bearer tokens

This pull request moves the mobile and desktop API callers to short-lived bearer tokens. It adds login and refresh responses, authenticates schedule and admin requests, and centralizes the admin role check. The old cookie path remains available to the small route-unit fixtures while callers move over.

The hand-written token helpers are reused so we do not add a package for a format the service already understands. Access and refresh lifetimes come from configuration, and the user store is still consulted during refresh. The response shapes follow the existing JSON envelope.

I tested this with `node --test` from the project root. The suite covers valid bearer access, missing headers, an empty bearer value, admin and planner claims, login validation, schedule routes, and the existing token contracts.
