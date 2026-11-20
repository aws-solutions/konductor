# Changelog

## 1.5.0
- Add reference expansion to the settings loader with `${NAME}` syntax support.
- Support `${NAME:-default}` syntax for default values when empty.
- Support defaults containing references for nested expansion.
- Support `\${NAME}` as a literal placeholder.
- Add `--no-expand` CLI flag to output raw values.
- Detect missing references and reference cycles with informative errors.

## 1.4.0
- Keep service configuration in small, reviewable environment files.

## 1.3.0
- Add JSON output to the command-line utility.

## 1.2.0
- Validate ports and timeouts when settings are created.
