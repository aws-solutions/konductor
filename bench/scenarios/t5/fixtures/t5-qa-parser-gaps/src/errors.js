"use strict";

class ParseError extends Error {
  constructor(message, line, column) {
    super(`line ${line}, column ${column}: ${message}`);
    this.name = "ParseError";
    this.line = line;
    this.column = column;
  }
}

class ValidationError extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.name = "ValidationError";
    this.errors = errors;
  }
}

module.exports = { ParseError, ValidationError };
