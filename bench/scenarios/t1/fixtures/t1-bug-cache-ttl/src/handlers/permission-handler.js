'use strict';

function permissionHandler(service, request) {
  if (!request || typeof request.id !== 'string' || request.id.length === 0) {
    return { status: 400, body: { error: 'id is required' } };
  }
  const permissions = service.getPermissions(request.id);
  return permissions ? { status: 200, body: permissions } : { status: 404, body: { error: 'permissions not found' } };
}

module.exports = { permissionHandler };
