import { publishOrderUpdated } from '../events/order-events.js';
import { toOrderResponse } from '../serialization/order-view.js';
import { validateOrderInput } from '../validation/order-input.js';

export function createOrderRoutes({ store, queue, now = () => new Date().toISOString() }) {
  function getOrder(id) {
    const order = store.get(id);
    if (!order) return notFound('order');
    return ok(toOrderResponse(order));
  }

  function updateOrder(id, input) {
    const errors = validateOrderInput(input, { partial: true, requireDeliveryNote: true });
    if (errors.length) return badRequest(errors);
    const current = store.get(id);
    if (!current) return notFound('order');
    const updated = {
      ...current,
      ...input,
      id,
      revision: (current.revision ?? 0) + 1,
      updatedAt: now()
    };
    store.save(updated);
    store.replaceItems(id, input.items ?? current.items);
    const saved = store.get(id);
    publishOrderUpdated(queue, saved);
    return ok(toOrderResponse(saved));
  }

  function listOrders(status) {
    return ok(store.list({ status }).map(toOrderResponse));
  }

  return { getOrder, updateOrder, listOrders };
}

function ok(body) {
  return { statusCode: 200, body };
}

function badRequest(errors) {
  return { statusCode: 400, body: { errors } };
}

function notFound(resource) {
  return { statusCode: 404, body: { error: `${resource} not found` } };
}
