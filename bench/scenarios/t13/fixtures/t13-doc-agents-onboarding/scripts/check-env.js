#!/usr/bin/env node
'use strict';
const required = ['SERVICE_SIGNING_KEY', 'DATABASE_URL', 'PORT'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`missing: ${missing.join(', ')}`);
  process.exitCode = 1;
}
