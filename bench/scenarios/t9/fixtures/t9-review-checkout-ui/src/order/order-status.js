export function watchOrder(orderId, fetchStatus, render, intervalMs = 4000) {
  const refresh = () => fetchStatus(orderId).then((status) => render(status));
  const timer = setInterval(refresh, intervalMs);
  refresh();
  return () => clearInterval(timer);
}
