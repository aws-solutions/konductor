# Northstar settings

Northstar is a small static settings surface used by the Signal workspace team. It keeps the page deliberately dependency-free so a fresh checkout can be opened directly in a browser.

## Run locally

Serve this directory with any static file server and open `index.html`. The page does not need a build step or an internet connection.

Run the checks with:

```text
node --test test/
```

The settings card contains the editable workspace sections. The editor tools below it are shared by several other screens in the product, so their keyboard behavior is kept consistent.

## Project notes

- `src/` contains browser modules.
- `styles/` contains the screen and print styles.
- `data/` contains sample content used in documentation and examples.
- `docs/` records product conventions rather than generated API output.
