const topic = 'orders.updated';

export function orderUpdated(order) {
  return {
    event: 'order.updated',
    orderId: order.id,
    customerId: order.customerId,
    status: order.status,
    sequence: order.revision,
    changedAt: order.updatedAt
  };
}

export function publishOrderUpdated(queue, order) {
  const message = orderUpdated(order);
  queue.publish(topic, {
    ...message,
    sequence: String(message.sequence)
  });
}

export function eventTopic() {
  return topic;
}

export function eventKey(message) {
  return `${message.event}:${message.orderId}:${message.sequence}`;
}
