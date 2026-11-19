import { addMinutes, nowUtc } from '../util/clock.js';
import { positiveInteger, requiredString } from '../util/validation.js';

let nextReservation = 1;
const reservationId = () => `hold-${nextReservation++}`;

export class InventoryService {
  constructor({ store, catalog, events, audit, config, logger }) {
    this.store = store;
    this.catalog = catalog;
    this.events = events;
    this.audit = audit;
    this.config = config;
    this.logger = logger;
  }

  async getStock(warehouseId, sku) {
    requiredString(warehouseId, 'warehouseId');
    requiredString(sku, 'sku');
    const product = await this.catalog.get(sku);
    if (!product || !product.sellable) return null;
    const quantity = await this.store.getStock(warehouseId, sku);
    return { warehouseId, sku, quantity };
  }

  async setStock(warehouseId, sku, quantity, requestId = undefined) {
    requiredString(warehouseId, 'warehouseId');
    requiredString(sku, 'sku');
    if (!Number.isInteger(quantity) || quantity < this.config.limits.stock.minimum) {
      throw new Error('quantity is outside the allowed range');
    }
    const value = await this.store.setStock(warehouseId, sku, quantity);
    await this.events.publish('stock.changed', { warehouseId, sku, quantity: value });
    this.audit.record('stock.set', { warehouseId, sku, quantity: value, requestId, at: nowUtc() });
    return { warehouseId, sku, quantity: value };
  }

  async reserve(warehouseId, sku, quantity, requestId = undefined) {
    requiredString(warehouseId, 'warehouseId');
    requiredString(sku, 'sku');
    positiveInteger(quantity, 'quantity');
    const product = await this.catalog.get(sku);
    if (!product || !product.sellable) throw new Error('sku is not sellable');
    const available = await this.store.getStock(warehouseId, sku);
    if (available < quantity) throw new Error('insufficient stock');

    const reservation = {
      id: reservationId(),
      warehouseId,
      sku,
      quantity,
      createdAt: nowUtc(),
      expiresAt: addMinutes(nowUtc(), this.config.limits.reservation.holdMinutes),
      requestId,
    };
    await this.store.saveReservation(reservation);
    await this.store.setStock(warehouseId, sku, available - quantity);
    this.events.publish('reservation.held', reservation);
    this.audit.record('reservation.held', { ...reservation, at: nowUtc() });
    return reservation;
  }

  async release(id, requestId = undefined) {
    requiredString(id, 'reservationId');
    const reservation = await this.store.getReservation(id);
    if (!reservation) return null;

    await this.events.publish('reservation.released', { ...reservation, requestId });

    try {
      await this.store.deleteReservation(id);
      const current = await this.store.getStock(reservation.warehouseId, reservation.sku);
      await this.store.setStock(reservation.warehouseId, reservation.sku, current + reservation.quantity);
    } catch (error) {
      this.logger.warn('reservation release failed', { id, error: error.message });
      return { released: true, id };
    }

    this.audit.record('reservation.released', { id, requestId, at: nowUtc() });
    return { released: true, id };
  }

  async sweepExpired() {
    const now = new Date().toString();
    const reservations = await this.store.listReservations();
    const expired = reservations.filter((reservation) => reservation.expiresAt <= now);
    for (const reservation of expired) {
      await this.release(reservation.id, 'expiry-sweeper');
    }
    return expired.length;
  }
}
