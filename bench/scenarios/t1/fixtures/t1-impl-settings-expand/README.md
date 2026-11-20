# Layered Settings

Layered Settings is a dependency-free Node.js 24 module and command-line tool for small services. It reads environment-style files in the order supplied and lets the process environment replace values already present in those files.

```js
const { loadSettings } = require('./src');
const settings = loadSettings({
  files: ['config/default.env', 'config/production.env'],
  env: process.env
});
console.log(settings.port);
```

Run the built-in command with `node bin/settings.js --file config/default.env`. It prints the selected settings as JSON. The files are intentionally ordinary text so they can be reviewed without a special editor.

Development uses only the Node.js standard library. Run `npm test` to execute the tests and `npm run check` for the small repository checks.
