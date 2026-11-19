const path = require('node:path');
const { loadConfig } = require('./config');
const { UserStore } = require('./store/user-store');
const { ShiftStore } = require('./store/shift-store');
const { createSessionRoutes } = require('./routes/session-routes');
const { createAdminRoutes } = require('./routes/admin-routes');
const { createScheduleRoutes } = require('./routes/schedule-routes');
const { authenticateBearer } = require('./middleware/bearer-auth');
const { requireRole } = require('./middleware/role-guard');
const { requestPath, jsonResponse } = require('./http');
const token = require('./security/token');

function createApp(config = loadConfig()) {
  const users = new UserStore(path.join(__dirname, '..', 'data', 'users.json'));
  const shifts = new ShiftStore(path.join(__dirname, '..', 'data', 'shifts.json'));
  const authOptions = { token, config };
  const authenticate = (request) => authenticateBearer(request, authOptions);
  const sessionRoutes = createSessionRoutes({ users, token, config });
  const adminRoutes = createAdminRoutes({ users, shifts, authenticate, requireAdmin: requireRole('admin') });
  const scheduleRoutes = createScheduleRoutes({ shifts, authenticate });

  return async function handle(request) {
    const pathName = requestPath(request);
    if (request.method === 'GET' && pathName === '/health') return jsonResponse(200, { status: 'ok' });
    if (request.method === 'POST' && pathName === '/login') return sessionRoutes.login(request);
    if (request.method === 'POST' && pathName === '/refresh') return sessionRoutes.refresh(request);
    if (request.method === 'GET' && pathName === '/admin/users') return adminRoutes.listUsers(request);
    if (request.method === 'POST' && pathName === '/admin/shifts') return adminRoutes.importShift(request);
    if (request.method === 'GET' && pathName === '/schedule') return scheduleRoutes.list(request);
    return jsonResponse(404, { error: 'not found' });
  };
}

module.exports = { createApp };
