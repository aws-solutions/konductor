"use strict";

const fs = require("node:fs");
const { parseAndValidate } = require("../src");

const file = process.argv[2];
if (!file) throw new Error("a config path is required");
parseAndValidate(fs.readFileSync(file, "utf8"));
console.log(`valid: ${file}`);
