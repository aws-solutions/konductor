# Atlas CLI

Atlas is a local, dependency-free tool for checking and describing small data files.
It is intentionally useful from scripts as well as from a terminal.

## Quick start

```sh
node bin/atlas.js --help
node bin/atlas.js check data/sample.json
```

The commands read local files and write short, stable summaries. Atlas does not send
input anywhere. Node.js 24 or newer is required.

Configuration can be supplied with `--config path/to/config.json`. The example
configuration in `config/default.json` is suitable for local work.

More detail is in `docs/commands.md` and `docs/configuration.md`.
