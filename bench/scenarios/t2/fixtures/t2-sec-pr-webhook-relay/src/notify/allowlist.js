export function isCustomerDestination(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith('.example.invalid');
  } catch { return false; }
}
