# Configuration

The default file is `config/default.json`. A custom file is selected with
`--config`. The `mode` value is either `safe` or `fast`; `color` is a boolean;
and `root` is a string used as the default input directory.

Atlas rejects malformed JSON and unknown mode values before running a command.
