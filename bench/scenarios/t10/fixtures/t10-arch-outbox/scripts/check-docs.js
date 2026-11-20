'use strict';
const fs=require('node:fs'); const text=fs.readFileSync('README.md','utf8'); if(!text.includes('Node 24'))process.exit(1); console.log('docs ok');
