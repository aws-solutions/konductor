// Display helpers shared by the checkout page.

export function money(pence) {
  const sign = pence < 0 ? '-' : '';
  const abs = Math.abs(pence);
  return `${sign}£${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Old helper from the first version of the shop; the page no longer uses it.
export function plural(n, word) {
  return n === 1 ? `${n} ${word}` : `${n} ${word}s`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;

export function validate(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Enter your full name';
  if (!EMAIL.test(form.email.trim())) errors.email = 'Enter an email address like name@example.com';
  if (!POSTCODE.test(form.postcode.trim())) errors.postcode = 'Enter a UK postcode, for example SW1A 1AA';
  return errors;
}
