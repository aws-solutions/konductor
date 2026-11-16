// SPDX-License-Identifier: Apache-2.0
// Loaded with `node --require` by exit-codes.test.js, so the real command line entry point can be run
// with one read made to fail. It stands in for what real files cannot be arranged to do: a file that
// vanishes between two steps of a run, or a bug in the code that reads it.
//
// BENCH_TEST_FAULT is JSON: { "file": "<end of the path to fail>", "error": "ENOENT" | "TypeError" }.
'use strict';

const fs = require('fs');

const fault = JSON.parse(process.env.BENCH_TEST_FAULT);
const originalReadFileSync = fs.readFileSync;

fs.readFileSync = function readFileSyncWithFault(file, ...rest) {
  if (String(file).endsWith(fault.file)) {
    if (fault.error === 'TypeError') throw new TypeError('simulated bug');
    // The shape Node gives a failed system call: a string code and syscall, and the path.
    throw Object.assign(
      new Error(`${fault.error}: simulated failure, open '${file}'`),
      {
        code: fault.error,
        errno: -2,
        syscall: 'open',
        path: String(file),
      },
    );
  }
  return originalReadFileSync.call(this, file, ...rest);
};
