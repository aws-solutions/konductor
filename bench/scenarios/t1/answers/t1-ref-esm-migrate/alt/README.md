# lantern-kit

`lantern-kit` formats short messages for reports and shell scripts.

```js
import lantern from 'lantern-kit';
lantern('ready'); // "> ready"
```

The command-line entry point accepts text, `--prefix <value>`, `--upper`, and `--version`:

```sh
lantern-kit --prefix '#' --upper ready
```

The two built-in plugin names are `compact` and `verbose`. Plugins receive a value and return a string.

## ES Modules

This package is published as ES modules. All imports should use ESM syntax:

```js
import lantern, { format, loadPlugin, banner, manifest, cycleValue } from 'lantern-kit';
```

## API

- `lantern(value, options)` - Format a value with optional prefix and upper options
- `format(value, options)` - Format function with prefix and upper options
- `loadPlugin(name)` - Async function to load plugins by name (compact, verbose)
- `banner` - Package banner string
- `manifest` - Package manifest object
- `cycleValue()` - Returns "cycle-a-cycle-b"

## CLI

```sh
lantern-kit [options] [text...]
  --prefix <value>  Set custom prefix (default: ">")
  --upper           Convert to uppercase
  --version         Print version (1.4.0)
```
