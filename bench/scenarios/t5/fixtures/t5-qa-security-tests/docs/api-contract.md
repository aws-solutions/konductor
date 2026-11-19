# Handler contract

Handlers receive `{ headers, params, body }` values from the edge adapter. They return a status number and, when useful, a body or errors array. A missing or expired bearer session is a 401 response.

Document reads return 404 for an unknown identifier and 403 when the signed-in user does not own the document. The administrator role can read every document.
