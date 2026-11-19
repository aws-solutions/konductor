function logRequest(requestId, method, pathname, status) {
  process.stdout.write(JSON.stringify({ requestId, method, pathname, status }) + '\n');
}

module.exports = { logRequest };
