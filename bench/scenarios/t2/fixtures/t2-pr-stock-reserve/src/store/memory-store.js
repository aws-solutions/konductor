import { InventoryStore } from './inventory-store.js';

const key = (warehouseId, sku) => `${warehouseId}:${sku}`;
const pause = () => new Promise((resolve) => setImmediate(resolve));

export class MemoryStore extends InventoryStore {
  constructor(seed = []) {
    super();
    this.stock = new Map(seed.map((row) => [key(row.warehouseId, row.sku), row.quantity]));
    this.reservations = new Map();
  }

  async getStock(warehouseId, sku) {
    await pause();
    return this.stock.get(key(warehouseId, sku)) ?? 0;
  }

  async setStock(warehouseId, sku, quantity) {
    await pause();
    this.stock.set(key(warehouseId, sku), quantity);
    return quantity;
  }

  async listStock(warehouseId) {
    await pause();
    return [...this.stock.entries()]
      .filter(([stockKey]) => stockKey.startsWith(`${warehouseId}:`))
      .map(([stockKey, quantity]) => ({ sku: stockKey.slice(warehouseId.length + 1), warehouseId, quantity }));
  }

  async saveReservation(reservation) {
    await pause();
    this.reservations.set(reservation.id, structuredClone(reservation));
    return structuredClone(reservation);
  }

  async getReservation(id) {
    await pause();
    const reservation = this.reservations.get(id);
    return reservation ? structuredClone(reservation) : null;
  }

  async listReservations() {
    await pause();
    return [...this.reservations.values()].map((reservation) => structuredClone(reservation));
  }

  async deleteReservation(id) {
    await pause();
    return this.reservations.delete(id);
  }
}
