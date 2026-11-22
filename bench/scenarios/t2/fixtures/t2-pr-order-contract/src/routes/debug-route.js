const debugHeaders = {
  'cache-control': 'no-store',
  'x-route-kind': 'diagnostic'
};

export function debugCustomerRoute({ customerStore, customerId, now = () => new Date().toISOString() }) {
  const customer = customerStore.get(customerId);
  if (!customer) return { statusCode: 404, headers: debugHeaders, body: { error: 'customer not found' } };
  return {
    statusCode: 200,
    headers: debugHeaders,
    body: {
      customer,
      lookedUpAt: now(),
      fields: Object.keys(customer).sort()
    }
  };
}

export function isDebugPath(pathname) {
  return pathname.startsWith('/debug/customers/');
}

export function debugCustomerId(pathname) {
  return pathname.split('/').filter(Boolean).at(-1);
}
