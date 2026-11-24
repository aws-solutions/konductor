#!/usr/bin/env node
'use strict';
if (!process.env.DATABASE_URL || /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  console.log('would reset the local database');
} else {
  console.error('refusing a non-local database');
  process.exitCode = 1;
}
