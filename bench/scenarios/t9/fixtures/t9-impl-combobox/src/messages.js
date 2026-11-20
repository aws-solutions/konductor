const messages = { saved: 'Your registration is on the list.', missingName: 'Please add your name.', missingEmail: 'Please add a working email address.' };
function messageFor(field) { return messages[field] || ''; }
if (typeof module !== 'undefined') module.exports = { messages, messageFor };
if (typeof globalThis !== 'undefined') globalThis.harborMessages = messages;
