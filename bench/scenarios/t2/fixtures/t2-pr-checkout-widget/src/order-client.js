export async function submitOrder(order, fetcher = globalThis.fetch) {
  const response = await fetcher('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(order)
  });
  if (!response.ok) throw new Error(`Order failed: ${response.status}`);
  return response.json();
}

export async function applyPromotion(code, fetcher = globalThis.fetch) {
  const response = await fetcher('/api/promotions/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code })
  });
  if (!response.ok) return { accepted: false, message: 'Promotion was not accepted.' };
  return response.json();
}
