const { jsonResponse } = require('../http');

function createScheduleRoutes({ shifts, authenticate }) {
  return {
    list(request) {
      if (authenticate) {
        const authentication = authenticate(request);
        if (!authentication.ok) return authentication.response;
      } else if (!request.sessionUser) {
        return jsonResponse(401, { error: 'login required' });
      }
      return jsonResponse(200, { shifts: request.query?.date ? shifts.forDate(request.query.date) : shifts.all() });
    },
  };
}

module.exports = { createScheduleRoutes };
