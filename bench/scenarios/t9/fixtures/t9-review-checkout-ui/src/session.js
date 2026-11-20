const SESSION_KEY = 'northstar-checkout-session';

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

export function clearSession() { localStorage.removeItem(SESSION_KEY); }
