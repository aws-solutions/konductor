# lantern-kit

`lantern-kit` formats short messages for reports and shell scripts.

```js
const lantern = require('lantern-kit');
lantern('ready'); // "> ready"
```

The command-line entry point accepts text, `--prefix <value>`, `--upper`, and `--version`:

```sh
lantern-kit --prefix '#' --upper ready
```

The two built-in plugin names are `compact` and `verbose`. Plugins receive a value and return a string.
