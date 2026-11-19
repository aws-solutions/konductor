#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { parseAndValidate, print } = require("./index");

function main(argv) {
  const checkOnly = argv[0] === "--check";
  const file = argv[checkOnly ? 1 : 0];
  if (!file) {
    console.error("usage: tide-config [--check] file");
    return 2;
  }
  try {
    const result = parseAndValidate(fs.readFileSync(file, "utf8"));
    if (!checkOnly) process.stdout.write(print(result));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
