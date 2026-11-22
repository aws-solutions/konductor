import { getBalance, setBalance } from './balance-store.js';
import { customerId, positivePoints } from './validation.js';
import { ok } from './http.js';

export async function redeemHandler(request) {
  const customer = customerId(request.customerId);
  const points = positivePoints(request.points);
  const current = await getBalance(customer);
  if (current.points < points) throw new Error('insufficient points');
  const balance = await setBalance(customer, current.points - points);
  return ok({ customer, points, balance: balance.points });
}
