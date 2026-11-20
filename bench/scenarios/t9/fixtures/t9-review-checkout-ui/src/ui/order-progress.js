export function renderProgress(root, status) {
  const labels = { accepted: 'Order received', packing: 'Being packed', shipped: 'On the way', delivered: 'Delivered' };
  root.textContent = labels[status.state] || 'Updating order status…';
}
