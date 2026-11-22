const balances = new Map();

function blank() { return { points: 0, version: 0 }; }

export function resetBalances() { balances.clear(); }

export async function getBalance(customer) {
  const current = balances.get(customer) ?? blank();
  return { ...current };
}

export async function setBalance(customer, points) {
  const current = balances.get(customer) ?? blank();
  const next = { points, version: current.version + 1 };
  balances.set(customer, next);
  return { ...next };
}

export async function compareAndSet(customer, expectedVersion, points) {
  const current = balances.get(customer) ?? blank();
  if (current.version !== expectedVersion) return false;
  balances.set(customer, { points, version: current.version + 1 });
  return true;
}
