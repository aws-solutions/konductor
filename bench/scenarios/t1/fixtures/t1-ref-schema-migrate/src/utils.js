function cleanText(value) {
  return value == null ? null : String(value).trim();
}

function isPresent(value) {
  return value != null && String(value).trim() !== '';
}

module.exports = { cleanText, isPresent };
