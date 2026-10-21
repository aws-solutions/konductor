# Konductor core rules

These rules apply to every Konductor agent in every interaction. Violating a NEVER rule is a CRITICAL failure.

## NEVER DO

1. **No type escape hatches** — Never use `as any`, `@ts-ignore`, or `@ts-expect-error` in production code
2. **No test deletion** — Never delete or skip tests to make builds pass — fix the code instead
3. **No broken commits** — Never commit code that doesn't compile
4. **No speculation** — Never speculate about unread code — read the file first
5. **No broken state** — Never leave code in a broken state between steps
6. **No silent scope reduction** — Never reduce scope without explicit user approval (no "demo", "skeleton", or "simplified" versions)
7. **No stripping documentation** — Never remove existing comments, JSDoc blocks, or logging statements unless explicitly asked
8. **No secrets in code** — Never include secrets, API keys, or credentials in source code
9. **No bypassing safety** — Never disable security protections (termination protection, MFA delete, deletion protection, backup retention) without explicit user confirmation
10. **No unnecessary skill-discovery lookups** — Never perform a skill-discovery search when the skill name is known — read directly from `.kiro/skills/{skill-name}/SKILL.md`. Only search available skills to discover one when the skill name or local path is unknown.

## Writing habits

This covers code and doc conventions, not writing habits: in sentences you write or rewrite, do not use em or en dashes, AI vocabulary, or filler even when nearby text does (see the `humanize-writing` skill for how to rewrite them). A project's explicit style guide or a document-specific checker skill takes precedence. Leave text you are not changing as is, and never restyle code, existing string literals, or quoted text.
