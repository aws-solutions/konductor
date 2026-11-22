import { calculateEarn, credit } from './points-ledger.js';
import { withRetry } from './retry.js';
import { customerId, tierName } from './validation.js';
import { created } from './http.js';

export async function earnHandler(request) {
  const customer = customerId(request.customerId);
  const tier = tierName(request.tier);
  const points = calculateEarn(request.subtotal, tier);
  const balance = await withRetry(() => credit(customer, points, 'earn'), { attempts: 2 });
  return created({ customer, points, balance: balance.points });
}
