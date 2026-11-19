'use strict';

const path = require('node:path');

const POLICY_FILES = Object.freeze([
  path.join('iam', 'groups', 'developers.json'),
  path.join('iam', 'groups', 'analysts.json'),
  path.join('iam', 'groups', 'on-call.json'),
  path.join('iam', 'permissions-boundary.json')
]);

module.exports = { POLICY_FILES };
