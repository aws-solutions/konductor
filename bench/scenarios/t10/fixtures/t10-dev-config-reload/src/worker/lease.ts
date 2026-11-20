export type Lease = { id: string; expiresAt: number };

export function leaseFor(id: string, now: number, seconds: number): Lease {
  return { id, expiresAt: now + seconds * 1000 };
}

export function leaseExpired(lease: Lease, now: number) {
  return now >= lease.expiresAt;
}
