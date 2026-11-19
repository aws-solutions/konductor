class QueueFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueueFormatError';
  }
}

module.exports = { QueueFormatError };
