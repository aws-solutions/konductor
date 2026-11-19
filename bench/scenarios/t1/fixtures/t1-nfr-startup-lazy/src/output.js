'use strict';

function line(text = '') {
  process.stdout.write(`${text}
`);
}

function error(text) {
  process.stderr.write(`${text}
`);
}

module.exports = { line, error };
