# Edits after the author's fix round

The author (gpt-5.6-luna) answered the fix note (ES-module repository: name the block test file block.test.cjs) with
shell commands inside the two document `tests` checks that write a `block-kit/package.json` of type `module` and copy a
template file. A Claude worker session changed only the checks and removed two files:
- task-draft.json: the two document `tests` checks now run `node --test --test-timeout=15000 block.test.cjs` and
  `BLOCK_KIT=rollout-kit node --test --test-timeout=15000 block.test.cjs`, as the kit's build step creates that file.
- hidden/block.test.cjs.template and hidden/block-kit/package.json (type module) were removed; the kit writes a
  block-kit/package.json of type commonjs and block.test.cjs itself.
No prompt, fixture, key, test or rubric change.
