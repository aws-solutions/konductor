import policy from '../config/points-policy.json' with { type: 'json' };
import tiers from '../data/tiers.json' with { type: 'json' };
import { getBalance, setBalance } from './balance-store.js';

export function calculateEarn(subtotal, tier = 'standard') {
  const match = tiers.find((entry) => entry.name === tier) ?? tiers[0];
  const raw = Number(subtotal) * match.multiplier;
  const scale = 10 ** policy.earnPrecision;
  return Math.floor(raw);
}

export async function credit(customer, points, reason = 'earn') {
  const current = await getBalance(customer);
  const next = await setBalance(customer, current.points + points);
  return { ...next, reason };
}

export async function debit(customer, points, reason = 'redeem') {
  const current = await getBalance(customer);
  if (current.points < points) throw new Error('insufficient points');
  return setBalance(customer, current.points - points).then((balance) => ({ ...balance, reason }));
}
