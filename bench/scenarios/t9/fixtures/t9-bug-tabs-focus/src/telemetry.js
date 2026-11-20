function pageEvent(page, action) {
  return { page, action, at: new Date().toISOString() };
}

function safeEventName(value) {
  return String(value).replace(/[^a-z0-9_.-]/gi, '-').toLowerCase();
}

module.exports = { pageEvent, safeEventName };
