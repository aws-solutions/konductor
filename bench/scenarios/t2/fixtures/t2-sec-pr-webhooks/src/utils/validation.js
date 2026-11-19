/**
 * URL validation utilities
 */

const INTERNAL_NETWORKS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}/,
  /^192\.168\.\d{1,3}\.\d{1,3}/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  /^::1$/,
  /^fd[0-9a-f]{2}:/,
  /^169\.254\.169\.254$/
];

const INTERNAL_HOSTNAMES = [
  'localhost',
  'localdomain'
];

export function isValidCallbackUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Check for internal networks
    const hostname = parsed.hostname;
    for (const pattern of INTERNAL_NETWORKS) {
      if (pattern.test(hostname)) {
        return false;
      }
    }
    
    // Check for internal hostnames
    if (INTERNAL_HOSTNAMES.includes(hostname.toLowerCase())) {
      return false;
    }
    
    // Require HTTPS in production
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}