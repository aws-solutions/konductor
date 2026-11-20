'use strict';

class InvalidUserIdError extends TypeError {
  constructor() {
    super('userId must be a non-empty string');
    this.name = 'InvalidUserIdError';
  }
}

module.exports = { InvalidUserIdError };
