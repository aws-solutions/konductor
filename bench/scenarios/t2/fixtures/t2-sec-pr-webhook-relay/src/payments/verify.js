export function paymentStatus(payload) {
  const status = payload?.status;
  return ['paid', 'failed', 'pending'].includes(status) ? status : 'unknown';
}
