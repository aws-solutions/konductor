function attachJson(response) {
  response.json = (status, value) => {
    response.statusCode = status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    if (status === 204) return response.end();
    response.end(JSON.stringify(value));
  };
  return response;
}

module.exports = { attachJson };
