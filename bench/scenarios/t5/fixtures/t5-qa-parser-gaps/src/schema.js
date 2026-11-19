"use strict";

const schema = Object.freeze({
  name: "string",
  timeout: "quantity",
  tags: "string[]"
});

function describe() {
  return Object.entries(schema).map(([key, type]) => `${key}: ${type}`).join(", ");
}

module.exports = { schema, describe };
