# Larkspur Market checkout frontend

This folder is the working copy for the Larkspur Market web shop checkout. It is intentionally small: the UI is represented by plain JavaScript modules and the tests run directly with Node.js. There is no bundler in this snapshot.

The address step has gathered several small fixes over time. Product notes, support exports, policy excerpts, and old drafts are mixed together because this is the material the frontend team currently has. `src/` is the code to preserve while the form is redesigned. `analytics/` lists event names used by the checkout dashboard. `data/` contains exported observations, not a contract.

Run the existing checks with:

```sh
node --test
```

The redesign should leave the rest of the checkout usable while making address entry less frustrating on small screens.
