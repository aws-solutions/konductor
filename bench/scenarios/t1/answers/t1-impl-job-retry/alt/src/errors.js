class QueueFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueueFormatError';
  }
}

class PermanentJobError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentJobError';
    this.retryable = false;
  }
}

module.exports = { QueueFormatError, PermanentJobError };
