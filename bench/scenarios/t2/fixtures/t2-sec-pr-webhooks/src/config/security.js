/**
 * Security configuration and constants
 */

// Public key ID for JWT verification (safe to log)
export const PUBLIC_KEY_ID = 'key_2024_v1_public';

// Default algorithm for signature verification
export const DEFAULT_SIGNATURE_ALGORITHM = 'sha256';

// Maximum age of webhook timestamps (5 minutes in milliseconds)
export const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

// Delivery ID replay window (10 minutes in milliseconds)
export const DELIVERY_ID_WINDOW_MS = 10 * 60 * 1000;

// Rate limiting configuration
export const RATE_LIMITS = {
  maxRequestsPerMinute: 60,
  maxRequestsPerHour: 1000
};