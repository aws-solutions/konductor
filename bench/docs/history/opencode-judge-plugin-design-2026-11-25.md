# Design: the opencode judge as a plugin part

Date: 2026-11-25. Status: step 1 built (2026-11-25; see BACKLOG B-014). Rows: BACKLOG B-014, DEBT D-212.

## The problem

The opencode judge backend is built into the core. `judge/opencode.js` requires two files inside
`plugins/opencode` (`parse.js`, `creds.js`), and the core names the backend in six places:

1. `judge/backends.js`: the `opencode` built-in, `OPENCODE_MODELS`, `opencodeModel` and `checkOpencodeJudges`.
2. `judge/config.js`: `maxPromptBytes` returns 400000 for opencode and 120000 for the rest.
3. `judge/run.js` and `judge/packrun.js`: the cache salt comes from `cacheSaltOf` in `judge/opencode.js`.
4. `runner/eval-commands.js`: `makeOpencodeJudgeCaller` reads the AWS and opencode flags and builds the caller.
5. `judge/model.js`: a reply with `usd` is tagged `backend: 'opencode'`.
6. `skilleval/skilleval.js` and `scripts/lib/chain/phases.js` require the opencode module or name the backend.

A second paid backend on Bedrock would copy all of this. A plugin backend can do none of it today: `makeCaller`
gets only `{ timeoutMs, rawDir, log }`, so it cannot read its own flags, and the core has no hook for a prompt cap,
a cache salt or a panel check.

A plugin folder also held one part only, and `plugins/opencode` is already the opencode harness.

## The fix in one line

The judge becomes a `judge-backend` part inside `plugins/opencode`, next to the harness. Its id stays `opencode`, and
its cache salt text stays the same, so saved judge files and caches still match and scores stay byte-equal.

## Steps

1. Built. A manifest may list `"parts"`: more parts of other kinds under the same name, each with its own `meta` and
   `entry` (`core/registry.js`, `plugin-registry.test.js`). Each registry part now carries its own `entry`; the
   three readers use it. No output changes.
2. Move the judge. `judge/opencode.js`, the model table and the panel check move to `plugins/opencode/judge.js`,
   with a `judge-meta.js` of `{ id: 'opencode', costUnit: 'usd', label, maxPromptBytes: 400000 }`. The entry exports
   `makeCaller({ timeoutMs, rawDir, log, flags })`, `cacheSalt(model)` and `checkJudges(judges)`. The core reads the
   prompt cap from the descriptor and calls the two hooks when a part has them; `flags` is the judge command's own
   options. The judge needs `stream`, `run-one`, `sandbox`, `procs` and `aws-creds` from `runner/lib`; the plugin
   lint allows only `bench/sdk`, so these join the SDK first. Done when the judge tests pass unchanged on the fake
   opencode and `harness-coupling-baseline.json` loses the two `judge/opencode.js` imports.
3. Drop the named exports `kiro`, `opencode`, `claudeCode` and `strands` from `runner/lib/harness/index.js`. Put
   `SUBAGENT_TOOLS` (today in `plugins/claude-code/parse.js`, read by core files) behind the descriptor `streams`.
   Shrink `harness-coupling-baseline.json`.
4. Docs: `write-a-plugin.md` "A judge backend" names the new hooks; `agents.md` and `reference.md` stay as they are
   unless a flag moves.

## Kept as it is

The judge flags (`--aws-creds-file`, `--aws-export-profile`, `--aws-profile`, `--aws-region`, `--opencode-bin`,
`--cache`) stay in the core flag table. Letting a plugin add flags is a separate change.
