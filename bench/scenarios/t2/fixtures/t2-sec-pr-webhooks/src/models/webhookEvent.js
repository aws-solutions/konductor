/**
 * Webhook event model (conceptual)
 * In a real implementation, this would be a database model
 */

export class WebhookEvent {
  constructor(data) {
    this.id = data.id || generateId();
    this.provider = data.provider; // 'github', 'stripe', 'generic'
    this.eventType = data.eventType;
    this.deliveryId = data.deliveryId;
    this.payload = data.payload;
    this.receivedAt = data.receivedAt || new Date().toISOString();
    this.processed = data.processed || false;
    this.callbackUrl = data.callbackUrl;
    this.callbackStatus = data.callbackStatus; // 'pending', 'success', 'failed'
  }
  
  toJSON() {
    return {
      id: this.id,
      provider: this.provider,
      eventType: this.eventType,
      deliveryId: this.deliveryId,
      receivedAt: this.receivedAt,
      processed: this.processed,
      callbackUrl: this.callbackUrl,
      callbackStatus: this.callbackStatus
    };
  }
}

function generateId() {
  return `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// In-memory store for demo purposes
export const webhookStore = {
  events: new Map(),
  
  save(event) {
    this.events.set(event.id, event);
    return event;
  },
  
  findById(id) {
    return this.events.get(id);
  },
  
  findByDeliveryId(deliveryId) {
    for (const event of this.events.values()) {
      if (event.deliveryId === deliveryId) {
        return event;
      }
    }
    return null;
  },
  
  list(limit = 100) {
    return Array.from(this.events.values())
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
      .slice(0, limit);
  }
};