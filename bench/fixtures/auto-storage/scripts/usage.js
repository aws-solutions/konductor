'use strict';

const path = require('node:path');
const { folderSizes } = require('../src');

const storageDir = process.argv[2] || path.join(__dirname, '..', 'storage');
for (const [folder, bytes] of Object.entries(folderSizes(storageDir))) console.log(`${folder.padEnd(10)} ${bytes} bytes`);
