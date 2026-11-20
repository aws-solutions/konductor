# Releasing

1. Run `node --test test/*.test.js`.
2. Move the entries under "Unreleased" in `CHANGELOG.md` to a new version heading.
3. Bump `version` in `package.json`.
4. Tag the commit `v<version>` and push the tag. The page is served as plain files from
   the `main` branch, so there is nothing to build.

If you change `tools/generate-orders.js`, regenerate `data/orders.js` in the same commit.
CI fails when the two disagree.
