"use strict";
class LedgerError extends Error { constructor(message) { super(message); this.name = "LedgerError"; } }
class ValidationError extends LedgerError { constructor(message) { super(message); this.name = "ValidationError"; } }
module.exports = { LedgerError, ValidationError };
