# Writing a design spec

After the brainstorming skill of [obra/superpowers](https://github.com/obra/superpowers) (MIT).

A design spec turns an idea into a design the owner can recognize, correct and approve before
anyone plans or writes code. It is written for two readers: the owner, who approves it, and the
planner, who argues every task of the implementation plan from it.

## Before you write

1. **Explore the project.** Read the relevant files, documents and recent commits. Read-only
   exploration is always allowed; nothing else is until the owner approves.
2. **Check the scope.** If the request describes several independent subsystems, say so at once
   and help the owner split it into sub-projects, each with its own spec, plan and implementation.
   Then design the first one. Do not refine details of a project that has to be split first.
3. **Discover intent.** Find out what the owner wants to accomplish, for whom, and what success
   looks like. When that is missing, ask one focused question about purpose before you propose
   features. Knowing the kind of application does not tell you why the owner wants it.
4. **Write back your understanding.** Summarize the intended outcome, the constraints and the
   success criteria in a short note. Separate what the owner said from what you assume, and invite
   correction. That note becomes the design brief.
5. **Ask one question at a time.** Prefer multiple-choice questions. When a topic needs more,
   ask several questions in turn rather than one long one.

## Designing

- **Propose two or three approaches** with their trade-offs. Lead with the one you recommend and
  say why. Remove every feature the goal does not need from each approach.
- **Present the design in sections,** each scaled to its complexity: a few sentences when it is
  simple, up to a few hundred words when it is subtle. Ask after each section whether it looks
  right, and revise before moving on. Cover architecture, components, data flow, error handling
  and testing.
- **Design for isolation.** Split the system into units that each have one purpose, a well-defined
  interface, and can be understood and tested on their own. For every unit, you should be able to
  say what it does, how it is used and what it depends on. Smaller, well-bounded units are also
  easier for an agent to change reliably.
- **In an existing codebase,** follow its patterns. Include a targeted improvement only where a
  problem in the existing code affects this work, such as a file that has grown too large to change
  safely. Do not propose unrelated refactoring.

## Writing the spec

Write the agreed design to the path the step block gives, using the template next to this guide.
Start the file with front matter that carries its status:

```yaml
---
status: draft
---
```

Change it to `approved` when the owner approves the spec. If the owner later sends the work back
to this step, set it to `draft` again while you revise. Commit the spec.

## Self-review

Read the written spec again with fresh eyes, and fix what you find in place:

1. **Placeholders:** no "TBD", "TODO", empty sections or vague requirements.
2. **Consistency:** no section contradicts another, and the architecture matches the features.
3. **Scope:** the spec fits one implementation plan. If not, it needs to be split.
4. **Ambiguity:** no requirement can be read two ways. Where one can, pick a meaning and write it
   down.

Then ask the owner to review the written file, and wait. If they ask for changes, make them and
repeat the self-review. Approval of the conversation only permits writing the spec; approval of
the written spec is what permits planning.
