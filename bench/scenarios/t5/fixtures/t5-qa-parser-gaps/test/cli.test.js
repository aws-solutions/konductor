"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { main } = require("../src/cli");
const { fixtureFile, removeFixture } = require("./helpers");

test("cli checks and formats a file", () => {
  const item = fixtureFile("sample.conf", 'name = "cli"\n');
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try {
    assert.equal(main(["--check", item.file]), 0);
    assert.equal(main([item.file]), 0);
  } finally {
    process.stdout.write = originalWrite;
    removeFixture(item);
  }
  assert.match(output, /name = cli/);
});
