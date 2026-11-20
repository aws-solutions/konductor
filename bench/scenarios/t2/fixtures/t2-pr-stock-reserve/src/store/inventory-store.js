export class InventoryStore {
  async getStock(_warehouseId, _sku) { throw new Error('getStock is not implemented'); }
  async setStock(_warehouseId, _sku, _quantity) { throw new Error('setStock is not implemented'); }
  async listStock(_warehouseId) { throw new Error('listStock is not implemented'); }
  async saveReservation(_reservation) { throw new Error('saveReservation is not implemented'); }
  async getReservation(_id) { throw new Error('getReservation is not implemented'); }
  async listReservations() { throw new Error('listReservations is not implemented'); }
  async deleteReservation(_id) { throw new Error('deleteReservation is not implemented'); }
}
