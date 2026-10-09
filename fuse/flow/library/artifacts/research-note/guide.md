# Writing a research note

A research note records what you found out about one question, so that a decision can rest on it
and nobody has to research the same thing again. The question can be about anything the work
depends on, and the sources are whatever answers it: this codebase, another project used as an
example, or documentation and other material on the internet. For example, "find in the Stripe API
documentation the smallest set of endpoints a checkout flow needs" is a research question as much
as "how does this service retry failed uploads". This guide says how to write and reuse notes; how
to research is up to you.

## Before you research

Look in the research directory the step names for notes on the same or a closely related topic.
If there are any, read them first. Tell the owner what they cover and how old they are, then offer
to answer from them as they are, to check them against the current code or sources and update them,
or to research afresh. Do not start a new note while an existing one covers the question.

If the question is unclear, settle what it is before you start, and say what is out of scope.

## Doing the research

- **This codebase:** read every relevant file, not only the entry points. Trace data from end to
  end, and read the callers, not only the definitions.
- **Another project:** say which project and version you read, and how the parts you report map
  onto this one.
- **Documentation or a topic on the internet:** prefer primary sources, such as specifications,
  official documentation and source code, and say which version or date each one describes.

Record conventions, hidden coupling, surprising behavior, risks and bugs as you come across them.
If the goal is to find bugs, keep reading until you have documented every likely bug in scope.

## The note

Write one file per question, named `YYYY-MM-DD-<topic>.md` with the date you wrote it. It holds:

1. **Question and scope:** what you set out to find out, and what you left out.
2. **Answer:** the key findings, first, in a few sentences each.
3. **How it works:** the detail behind the findings, naming the files, modules or functions in
   code and linking external sources.
4. **Conventions, risks and bugs:** what someone building on this must know.
5. **Open questions:** what you could not settle, and what would settle it.

Leave out sections that do not apply. Every claim names where it comes from, so it can be checked:
a file, module or function in code, or a link to an external source. Do not give line numbers;
they go stale as soon as the code changes.

## Handing it over

The note is what the owner reviews, not the chat summary. Give its path, summarize the findings that
bear on the decision at hand, and continue the step with them.
