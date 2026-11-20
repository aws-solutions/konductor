import './countries.js';
import './filter.js';
import './typeahead.js';

const registration = document.querySelector('#registration-form');
const notice = document.querySelector('#form-message');
const country = document.querySelector('#nation-input');
globalThis.installCountrySearch(country, registration.querySelector('[name="country_code"]'), document.querySelector('#nation-results'), document.querySelector('#nation-hint'));
registration.addEventListener('submit', (event) => {
  event.preventDefault();
  notice.textContent = registration.elements.attendee_name?.value.trim() ? 'Your registration is on the list.' : 'Please add your name.';
});
