"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fixtureFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tide-test-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { dir, file };
}

function removeFixture(item) {
  fs.rmSync(item.dir, { recursive: true, force: true });
}

module.exports = { fixtureFile, removeFixture };
