# Writing an implementation plan

After the writing-plans skill of [obra/superpowers](https://github.com/obra/superpowers) (MIT).

Write the plan for an engineer who has seen neither this codebase nor the spec. Assume they write
idiomatic code once they know the exact interface and the exact test, and that they make a
reasonable choice wherever the plan leaves one open. What they cannot know is what you decided:
which files, which names and signatures, which values from the spec, and which tests prove each
task. The plan records those decisions and nothing else. Keep it free of repetition and of
features the spec does not ask for, test-first, with frequent commits.

## Before the tasks

1. **Check the scope.** If the spec covers several independent subsystems, suggest one plan per
   subsystem, each producing working, testable software on its own.
2. **Map the files.** List every file the work creates or changes and what each one is
   responsible for. Give each file one responsibility, prefer small focused files, and keep files
   that change together in the same place. Split by responsibility, not by technical layer. In an
   existing codebase, follow its patterns.
3. **Copy the global constraints.** Every project-wide requirement from the spec, such as version
   floors, dependency limits, naming and platform rules, goes in the Global Constraints section,
   one per line, with exact values copied verbatim. Every task implicitly includes this section.
4. **Write the review focus.** List up to five inputs or failure modes that the spec implies but no
   task's tests exercise, and that are most likely to hurt a person using the software. Name the
   input and the behavior a reasonable person would expect. Then add a test for each one to the
   task that owns the code.

## Tasks

A task is the smallest unit that carries its own test cycle and is worth a reviewer's verdict.
Fold setup, configuration and documentation into the task whose deliverable needs them. Split only
where a reviewer could reject one task while approving its neighbor. Each task ends with a
deliverable that can be tested on its own.

Each task names its files and an **Interfaces** block: what it consumes from earlier tasks and what
it produces for later ones, with exact names, parameters and return types. An implementer sees only
their own task, so this block is how they learn the names their neighbors use.

Each step is one action with a checkable result:

- **A test step** gives the test's name and its assertions as code, with the spec's exact values.
- **A run step** gives the command and the expected output, for example "FAIL: function not
  defined" before the code exists and "PASS" after.
- **A code step** gives the exact signature and file, and the values the spec fixes. The
  implementer writes the body. Show a body only for an algorithm the signature and tests do not
  determine, or for exact text the spec fixes.
- **A commit step** gives the files and the commit message.

A step is done when the implementer can write exactly one reasonable thing from it. A line that
decides nothing, such as "handle edge cases" or "add tests for the above", is a gap. A plan longer
than the code it describes has written the code instead of planning it.

## Self-review

Check the finished plan against the spec, and fix what you find in place:

1. **Coverage:** every requirement in the spec points to a task.
2. **Steps:** every step lets the implementer write exactly one reasonable thing.
3. **Consistency:** names, types and signatures in later tasks match the ones earlier tasks define.
4. **Review focus:** each listed input has its test in the owning task. An empty section means you
   checked and found none.
5. **Proportion:** if code blocks are most of the document, replace bodies with signatures, test
   names and assertions.

## Status and hand-over

Start the file with front matter that carries its status and the execution mode:

```yaml
---
status: draft
execution: subagent-driven
---
```

Recommend one execution mode and give the reason:

- **subagent-driven:** a fresh implementer for each task and a fresh reviewer after each one, then
  one whole-branch review. The most thorough, and the most expensive.
- **inline:** you implement every task yourself in this session, then one fresh reviewer checks the
  whole branch. Cheaper and faster, with no independent review until the end.

Ask the owner to review the plan and choose the mode. When they approve, set `status: approved`
and record their choice in `execution`. If they send the work back, set `status: draft` again.
