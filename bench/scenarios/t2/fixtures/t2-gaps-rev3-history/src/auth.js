import { ROLES } from './constants.js';

export function requireRole(user, role) {
  if (!user || user.role !== role) throw new Error('forbidden');
  return user;
}

export function isStaff(user) {
  return user?.role === ROLES.ADMIN || user?.role === ROLES.SUPPORT;
}
