'use strict';

/**
 * HTTP client of the supplier's legacy item service. `baseUrl` is the service root; `fetchImpl` is the fetch
 * function (the global one by default). Returns `{ fetchItem(sku) }`, which rejects with an Error carrying the
 * supplier's `code`.
 */
function createLegacyClient({ baseUrl, fetchImpl = globalThis.fetch }) {
  async function fetchItem(sku) {
    const res = await fetchImpl(`${baseUrl}/items/${encodeURIComponent(sku)}`);
    const body = await res.json();
    if (!res.ok) throw Object.assign(new Error(body.message || `supplier error ${res.status}`), { code: body.code });
    return body;
  }
  return { fetchItem };
}

module.exports = { createLegacyClient };
