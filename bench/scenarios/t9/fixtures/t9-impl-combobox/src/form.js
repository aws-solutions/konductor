function readRegistration(form) { return Object.fromEntries(new FormData(form).entries()); }
function registrationSummary(values) { return `${values.attendee_name || ''} · ${values.email || ''}`; }
if (typeof module !== 'undefined') module.exports = { readRegistration, registrationSummary };
