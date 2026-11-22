import { requireRole } from './auth.js';
import { getBalance, setBalance } from './balance-store.js';
import { ok } from './http.js';

export async function inspectBalance(request) {
  requireRole(request.user, 'admin');
  const balance = await getBalance(request.customerId);
  return ok({ customer: request.customerId, balance: balance.points });
}

export async function adjustBalance(request) {
  const current = await getBalance(request.customerId);
  const balance = await setBalance(request.customerId, current.points + Number(request.points));
  return ok({ customer: request.customerId, balance: balance.points });
}
