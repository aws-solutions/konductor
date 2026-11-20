export function isCardNumber(value) { return /^\d{13,19}$/.test(String(value).replaceAll(' ', '')); }
export function isPostcode(value) { return /^[A-Za-z0-9 -]{4,10}$/.test(String(value).trim()); }
export function required(value) { return String(value ?? '').trim().length > 0; }
