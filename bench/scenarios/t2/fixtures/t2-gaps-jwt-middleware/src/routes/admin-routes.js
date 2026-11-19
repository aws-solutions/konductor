const { jsonResponse } = require('../http');

function createAdminRoutes({ users, shifts, authenticate, requireAdmin }) {
  function authorize(request) {
    const authentication = authenticate(request);
    if (!authentication.ok) return authentication.response;
    const permission = requireAdmin({ ...request, auth: authentication.claims });
    if (!permission.ok) return jsonResponse(permission.status, permission.body);
    return null;
  }

  return {
    listUsers(request) {
      const denied = authorize(request);
      if (denied) return denied;
      return jsonResponse(200, { users: users.listActive() });
    },
    importShift(request) {
      const denied = authorize(request);
      if (denied) return denied;
      const shift = shifts.add(request.body);
      return jsonResponse(201, { shift });
    },
  };
}

module.exports = { createAdminRoutes };
