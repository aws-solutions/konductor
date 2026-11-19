"use strict";
const fs = require("node:fs");
const path = require("node:path");
for (const name of fs.readdirSync(path.join(__dirname, "..", "src"))) if (!name.endsWith(".js")) process.exitCode = 1;
console.log("source layout looks good");
