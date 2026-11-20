import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const localLinks = [...html.matchAll(/(?:href|src)="([^"#]+)"/g)].map((match) => match[1]);
for (const link of localLinks) {
  if (!link.startsWith('http') && !fs.existsSync(new URL(`../${link}`, import.meta.url))) process.exitCode = 1;
}
