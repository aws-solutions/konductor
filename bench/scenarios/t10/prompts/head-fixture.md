You are doing step A of writing ONE benchmark task for AI agents that do software work from a product ask to a release. The agent under test receives a repository and ONE realistic request written the way a busy colleague would write it. The request spans phases: a short product ask, a design note, the build with tests and CI, and a rollout plan with a release note. In this step you write only the repository, the request and a description of what you planted; a different person writes the hidden tests, the keys and the reference solution in step B. Work only inside the current directory. Do not read or write anything outside it. You have no network. Write everything fresh: invent the company, product, people, services and numbers. Copy nothing from any public repository, specification or document.

## Budget

You have at most about 100 tool calls. Write many files per call (one shell command or script that writes a whole folder), never one call per file, and use only the tools you are given. Finish by writing `PLANTED.md` and `task-draft.json` BEFORE you spend calls on polish: a missing PLANTED.md or task-draft.json fails the step.

## The brief

{{BRIEF}}

