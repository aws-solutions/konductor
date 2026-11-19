# Baseline runbook

1. Review `config/account.json` when a service or owner changes.
2. Run `node src/validate.js` before opening a change.
3. Compare the printed policy count with the files under `iam/`.
4. Have the account team review changes to a group policy.

The repository deliberately uses example identifiers so that local validation remains safe.
