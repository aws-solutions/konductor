# Northstar Help Centre

Northstar Help Centre is a small, dependency-free site for product guidance and account settings. It is served as plain HTML, CSS, and JavaScript, so a local web server is enough to preview it.

## Local preview

Run any static file server from this directory and open `index.html`. The account settings page is at `account.html`.

## Checks

The project uses Node's built-in test runner. No package installation is needed.

```sh
npm test
```

Content lives in `data/`, presentation styles live in `styles/`, and browser modules live in `src/`. Section URLs use short hash names so a support specialist can share a link to a particular topic.

## Project notes

The copy is maintained by the customer education group. New article metadata belongs in `data/articles.json`; reusable page behavior belongs in `src/`.
