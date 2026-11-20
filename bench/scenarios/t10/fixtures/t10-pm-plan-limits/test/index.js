'use strict';
for (const file of [
  'config.test.js', 'store.test.js', 'accounts.test.js', 'projects.test.js',
  'members.test.js', 'services.test.js', 'http.test.js', 'helpers.test.js', 'scripts.test.js'
]) require(`./${file}`);
