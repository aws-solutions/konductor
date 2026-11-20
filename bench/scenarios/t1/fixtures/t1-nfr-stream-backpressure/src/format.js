function toLine(value) {
  return JSON.stringify(value) + "\n";
}

function parsePort(value, fallback = 3000) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

module.exports = { toLine, parsePort };
