'use strict';

function list(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function lint(document) {
  const problems = [];
  if (!document || typeof document !== 'object') return ['document is not an object'];
  if (document.Version !== '2012-10-17') problems.push('Version must be 2012-10-17');
  const statements = list(document.Statement);
  if (!statements.length) problems.push('no Statement');
  statements.forEach((statement, index) => {
    if (statement.Effect !== 'Allow' && statement.Effect !== 'Deny') problems.push(`statement ${index}: invalid Effect`);
    if ((statement.Action === undefined) === (statement.NotAction === undefined)) problems.push(`statement ${index}: action selector`);
    if (statement.Resource !== undefined && statement.NotResource !== undefined) problems.push(`statement ${index}: resource selector`);
  });
  return problems;
}

module.exports = { lint };
