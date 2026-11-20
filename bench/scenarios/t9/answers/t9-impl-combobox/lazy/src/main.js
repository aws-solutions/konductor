const field = document.querySelector('#country');
field.addEventListener('focus', () => field.setAttribute('aria-expanded', 'true'));
field.addEventListener('blur', () => field.setAttribute('aria-expanded', 'false'));
document.querySelector('#registration-form').addEventListener('submit', (event) => event.preventDefault());
