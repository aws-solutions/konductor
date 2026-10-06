# Writing a feature spec

A feature spec says what one feature does and how it will be shown to work, short enough for the
owner to read and approve in a few minutes. It is the authority the implementation and the review
are checked against.

## What it holds, in this order

1. **For the owner:** the decisions you need from them and any open question, each with your
   recommendation. Title each one with what it decides, such as "Matching rule: which free slot a
   booking request gets", and give enough context that the owner can decide without reading the
   rest of the spec first. Leave the section out when there is nothing to decide.
2. **What and for whom:** the request in one or two sentences, and the outcome the owner wants.
3. **Scope:** what the feature includes, and what it does not.
4. **How it fits the code:** the files, modules or interfaces it changes or adds, found by reading
   the code, with paths.
5. **Acceptance tests:** one per behavior the feature must have, each written so that a test can
   check it, from the request and not from an implementation you have in mind.
6. **Assumptions and decisions:** what you decided yourself, with the reason.
7. **Deferred:** ideas and extensions that came up but are not part of this feature, so they are
   recorded instead of built.

Keep each section as short as the feature allows; a small feature may need only a few lines per
section. Leave out what does not apply.
