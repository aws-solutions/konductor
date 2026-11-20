You wrote the benchmark task in the current directory (`fixture/`, `hidden/`, `solution/`, `alt/`, `lazy/`, `task-draft.json`, `kit/`). A reviewer of another model family checked it, and the free dry run scored it. Their findings are below. Repair every real defect they name, in the task files themselves, in one pass. Work only inside the current directory; you have no network. The rules you wrote it under still hold: the request names no method and lists no trap, decision or answer the agent must find in the folder; nothing in the fixture hints at the answer; every check passes the reference. If the fixture is a git repository (`fixture/dotgit`), change its history only by rebuilding it with `gen/make-repo.sh` and renaming `.git` to `dotgit` again.

## Findings

{{FINDINGS}}

## Finish

Run `node kit/selfcheck.js` until the reference scores 95 or more, `alt/` 80 or more, the plain fixture 20 or less and `lazy/` 40 or less, with `deterministic` true. Print a short list of what you changed. Stop.
