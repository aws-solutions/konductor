'use strict';

function profileHandler(service, request) {
  if (!request || typeof request.id !== 'string' || request.id.length === 0) {
    return { status: 400, body: { error: 'id is required' } };
  }
  const profile = service.getProfile(request.id);
  return profile ? { status: 200, body: profile } : { status: 404, body: { error: 'profile not found' } };
}

module.exports = { profileHandler };
