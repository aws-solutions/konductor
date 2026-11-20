const form = document.querySelector('#registration-form');
const message = document.querySelector('#form-message');
form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = form.elements.attendee_name?.value.trim();
  message.textContent = name ? 'Your registration is on the list.' : 'Please add your name.';
});
