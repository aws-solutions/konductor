function createHttpHandler(worker, logger = console) {
  return async function handle(request, response) {
    try {
      const result = await worker.accept(request.body);
      response.statusCode = 202;
      response.end(JSON.stringify(result));
    } catch (error) {
      logger.error(error.message);
      response.statusCode = 500;
      response.end(JSON.stringify({ status: 'error' }));
    }
  };
}

module.exports = { createHttpHandler };
