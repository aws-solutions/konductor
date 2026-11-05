<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflows step 1c: decisions

Choices made in the engine for step 1c (the file format and its checks) where
[the specification](workflows-spec.md) is silent or open. A reviewer who disagrees with one should say so on the pull
request, and the choice changes there. The spec stays the authority on the rules.

## Engine layout

- **Packages are `workflow-core` and `workflow-adapters`**, in the folders `core/` and `adapters/`. A package named
  `core` would shadow the standard library's `core` crate.
- **The core allow list is `saphyr-parser` only.** The core needs neither `thiserror` nor `serde`. `saphyr-parser` is
  pinned with `=0.3.3`, the repo's convention. The purity test reads the direct dependencies of the core. It does not
  look at their dependencies, so a follow-up should add a `cargo tree` or `cargo-deny` check of the whole tree.
- **The core writes its own JSON** (`core/src/json.rs`, a small value type). Objects are `BTreeMap`s, so keys are sorted
  by construction. The CLI turns on `serde_json`'s `preserve_order`, which would keep insertion order.
- **`WorkflowSource` has two methods**, one for the workflow and one for a prompt file. The core defines it and the
  adapters implement it. The size and UTF-8 rule is one function in the core (`decode_file`).
- **`libc` is a pinned dependency of the adapters on Unix**, for `O_NOFOLLOW` and `O_NONBLOCK`. Without them the open of
  a name that was swapped for a link or a pipe after it was looked at could follow the link or hang.

## Reading files

- **No link below the base is followed**, including `.konductor` and `workflows` themselves. The base (the project root
  or the home folder) is the user's choice and is not checked. After the open, the file is compared again by device and
  inode with the one that was looked at.
- **A nearer file that the rules treat as not there does not hide a farther one.** A project file over 256 KiB, a link,
  a file that is not UTF-8 and a file that cannot be read fall through to the user file. Lookup lists each file it
  passed over with the reason, so a caller can say which file it used. The reason is that "treated as not there" is the
  spec's rule, and the note keeps the choice visible.
- **The project root is the current directory.** There is no search upward from a subdirectory. This matches `init` and
  `config`.
- **An empty `params.goal.default: ''` is accepted, and so is a default of any length.** The engine checks only that
  `description` and `default` are strings. The Keys table sets no limit on either, and the 2048-character limit applies
  to the goal text of a run, which is checked when a run starts, not to the file.
- **A name that matches no file is a usage error (64) in the CLI**, not 65.

## Rules the spec leaves open

- **A path has no empty and no `.` segment** (`./a`, `a//b`, `dir/`). The spec's path rule covers this, under "Rules for
  every file" in [the specification](workflows-spec.md). The engine applies it as written, so the author gets the real
  rule up front and later steps never have to normalize a path.
- **Text that looks like a template reference is `NOT_SUPPORTED_BY_THIS_BUILD`**, in an inline `prompt` and in the text of
  a `prompt_file`, as the spec says until slice 2 defines the escape. The pattern is the spec's, found by a small scanner
  in one pass. Any other brace is literal. An inline `prompt` reports at most 20 of these findings, so the report stays
  small. A `prompt_file` reports one finding with the count. An inline match is reported where it is in the file, and a
  match in a file's text at the `prompt_file` value.
- **Booleans are the YAML 1.2 core set**: `true`, `True`, `TRUE`, `false`, `False`, `FALSE`. `yes`, `no`, `on` and `off`
  are strings.
- **Any `format` other than the string `konductor/1` is `UNSUPPORTED_FORMAT`**, whatever its type. A `version` that is
  not a string (`version: 1.1`) is `WRONG_TYPE`. A string that is not `X.Y.Z` (`'1.1'`) is `INVALID_VALUE` with the
  suggestion `0.1.0`.
- **A stage that has only a later-slice kind key** (`run`, `uses`, ...) is reported for that key and not also as
  `STAGE_KIND_MISSING`. Two kind keys are `STAGE_KIND_AMBIGUOUS` at the stage.
- **A duplicate check id is `INVALID_VALUE`.** The spec says ids are unique and names no code, and this is the code for
  a value outside its rules.
- **`params.goal` has only `description` and `default`.** `type` and `required` under it are `UNKNOWN_KEY`, because the
  spec's Keys table gives them to `params.<name>`, and the canvas stub's table agrees. Any other param is
  `NOT_SUPPORTED_BY_THIS_BUILD`, and its name is not checked against the param pattern in this build.
- **A key name is one key.** A name that holds `.`, `[`, `]` or `<` is never looked up as a table path, so
  `intent.outcome` written at the top level is `UNKNOWN_KEY`.
- **Only two "planned forms" are reachable in a slice 1 build**: a list for `params` is `WRONG_TYPE`, and `description`
  is `UNKNOWN_KEY`. The other two sit under `outputs` and `run`, which are reported as later-slice keys first.
- **A syntax error is the only finding when the text is not YAML.** Anchors, tags and the like are reported with any
  duplicate keys, and the checks of the format do not run after either.
- **The scanner's nesting limit (255, on one line of brackets) is reported as `YAML_UNSUPPORTED`**, the same as the limit
  of 32, because the scanner reads the whole line before it gives the first event.

## Diagnostics

- **A message says "is not supported yet" and does not name a slice.** The slice is the `slice` field of the diagnostic
  in the Rust API. It is not in the JSON, which follows the canvas contract. This departs from the spec line that the
  message names the slice. The reason is that the message is read by users, who have no use for a slice number.
- **A path never holds a key that looks like a secret.** A key that is not short and plain is written `(not shown)` in
  `path`, as it is in a message. A stage name is hidden only when it starts like a credential.
- **A hex-like stage name shows in `path` while `quote()` hides it in a message.** A stage name already follows the name
  pattern and is how the canvas addresses a stage, so hiding it would make the path useless. A message can hide a value
  at no cost. Only a name that starts like a credential is hidden in a path.
- **Past 40 stages the limit is reported once and the stages beyond it are not read**, so the number of findings, and
  the size of the report, stay bounded whatever the size of the list.
- **`counts.stages` in the check report is the number of entries the file lists**, even when the file has errors.
