import './countries.js';
import './filter.js';
import './country-picker.js';

const form = document.querySelector('#registration-form');
const message = document.querySelector('#form-message');
const countryInput = document.querySelector('#country');
globalThis.mountCountryPicker({
  input: countryInput,
  hidden: document.querySelector('#country-code'),
  list: document.querySelector('#country-options'),
  status: document.querySelector('#country-status')
});
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = form.elements.attendee_name?.value.trim();
  message.textContent = name ? 'Your registration is on the list.' : 'Please add your name.';
});
