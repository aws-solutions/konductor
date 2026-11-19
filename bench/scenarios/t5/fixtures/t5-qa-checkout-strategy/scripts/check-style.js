const fs = require('node:fs');
const path = require('node:path');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

const source = files(path.join(__dirname, '..', 'src')).filter((file) => file.endsWith('.js'));
const longLines = source.flatMap((file) => fs.readFileSync(file, 'utf8').split('\n').map((line, i) => line.length > 140 ? `${file}:${i + 1}` : null).filter(Boolean));
if (longLines.length) process.exitCode = 1;
