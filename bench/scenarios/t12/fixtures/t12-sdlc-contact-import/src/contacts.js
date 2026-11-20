'use strict';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An in-memory address book. add() throws on bad input; has() compares emails without case. */
function createBook() {
  const contacts = [];
  return {
    add({ name, email, phone = '' }) {
      if (typeof name !== 'string' || !name.trim()) throw new Error('name is required');
      if (typeof email !== 'string' || !EMAIL.test(email.trim())) throw new Error('email is invalid');
      const c = { name: name.trim(), email: email.trim(), phone: String(phone || '').trim() };
      contacts.push(c);
      return c;
    },
    has(email) {
      const e = String(email).trim().toLowerCase();
      return contacts.some((c) => c.email.toLowerCase() === e);
    },
    list() {
      return contacts.map((c) => ({ ...c }));
    },
  };
}

module.exports = { createBook, EMAIL };
