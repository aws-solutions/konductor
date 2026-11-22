import rules from '../data/expiry-rules.json' with { type: 'json' };
import { businessDate, addDays } from './clock.js';
import { getBalance, setBalance } from './balance-store.js';

export async function expireCustomer(customer, lastEarnedDate, now = new Date()) {
  const expiryDate = addDays(lastEarnedDate, 365 + rules.graceDays);
  const localDate = new Date(now).toLocaleDateString('en-CA');
  if (localDate <= expiryDate) return { expired: false, date: expiryDate };
  const current = await getBalance(customer);
  await setBalance(customer, 0);
  return { expired: true, points: current.points, date: expiryDate };
}
