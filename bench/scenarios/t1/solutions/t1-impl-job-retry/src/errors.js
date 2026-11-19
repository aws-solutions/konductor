class QueueFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueueFormatError';
  }
}

class PermanentJobError extends Error {
  constructor(message, code = 'PERMANENT_JOB_ERROR') {
    super(message);
    this.name = 'PermanentJobError';
    this.code = code;
    this.retryable = false;
  }
}

module.exports = { QueueFormatError, PermanentJobError };
