You are doing step B of writing ONE benchmark task for AI agents that do software work from a product ask to a release. Someone else (step A) wrote the repository, the request and a description of what they planted. You write the hidden part. Work only inside the current directory. Do not read or write anything outside it. You have no network. Do not change anything under `fixture/`, and do not change `PLANTED.md`.

- `fixture/`: the repository the agent under test gets.
- `task-draft.json`: holds the request (`prompt`, which you keep as it is) and must receive the rest of the keys below.
- `PLANTED.md`: the author's description of the interfaces, traps, design decisions and reference files.

Check every paragraph of `PLANTED.md` against the fixture yourself before you rely on it; correct what the author got wrong in YOUR files (tests, keys, solution) and leave out a trap you cannot see in the fixture. If the request promises an interface that `PLANTED.md` or the fixture does not support, make the tests follow the request. The request is the contract.


## Budget

You have at most about 80 tool calls. Write many files per call, never one call per file, and use only the tools you are given. Write `task-draft.json` early and improve it.

