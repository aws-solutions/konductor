#!/usr/bin/env node
import { run } from '../cli.js';

try {
  process.exitCode = run();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
