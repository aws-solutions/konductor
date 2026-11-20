'use strict';

function summary(objects, dryRun) {
  const verb = dryRun ? 'would upload' : 'uploaded';
  return `${verb} ${objects.length} file(s)`;
}

module.exports = { summary };
