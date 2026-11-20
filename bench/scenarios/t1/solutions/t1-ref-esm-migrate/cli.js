import lantern from './index.js';
import { VERSION } from './lib/constants.js';

export function parse(argv) {
  const options = {};
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--upper') options.upper = true;
    else if (arg === '--prefix') options.prefix = argv[++i] ?? '';
    else if (arg === '--version') options.version = true;
    else words.push(arg);
  }
  return { options, words };
}

export function run(argv = process.argv.slice(2), output = process.stdout) {
  const { options, words } = parse(argv);
  if (options.version) {
    output.write(`${VERSION}\n`);
    return 0;
  }
  output.write(`${lantern(words.join(' '), options)}\n`);
  return 0;
}
