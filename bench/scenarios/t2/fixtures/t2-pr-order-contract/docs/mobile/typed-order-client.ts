export type OrderResponse = {
  id: string;
  customerId: string;
  status: 'draft' | 'paid' | 'paused' | 'packing' | 'shipped' | 'delivered';
  statusLabel: string;
  displayTotal: string;
  deliveryNote: string;
  items: Array<{ sku: string; quantity: number }>;
  updatedAt: string;
};

export function readOrder(payload: string): OrderResponse {
  return JSON.parse(payload) as OrderResponse;
}
