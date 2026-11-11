---
name: smithy-validation
description: Validates Smithy API models for quality, best practices, and production readiness. Use before implementation to catch structural, naming, security, and code generation issues. Produces prioritized findings with specific fixes.
version: 1.1.0
tags: [skill, smithy, api-design, validation, checker, code-review]
---

# Smithy Validation

## Overview

Reviews Smithy models against AWS best practices covering structure, naming conventions, documentation completeness, type safety, error handling, security traits, and code generation compatibility. Each finding names its location and gives a concrete fix.

## Usage

Use this skill when:

- Reviewing a Smithy model before handing off to implementation
- Checking API design for security and type safety issues
- Validating code generation compatibility

## Review Categories

### 1. Structural Validation

**Check for:**

- Valid Smithy syntax and structure
- Proper namespace declarations
- Correct shape definitions and references
- Valid trait applications
- Proper use of Smithy version (`$version: "2"`)
- The service `version` is set; any string is valid, and a date is only a convention

**Common Issues:**

- Missing or incorrect namespace
- Undefined shape references
- Invalid trait syntax
- Mismatched input/output types
- IDL 2.1 syntax (inline list or map declarations, `#re` tagged strings, member index shorthand) in a file pinned to `"2"` or `"2.0"`. It needs `$version: "2.1"` and Smithy 1.75.0 or later

### 2. Naming Conventions

**Verify:**

- Service names use PascalCase
- Operation names use PascalCase with verb prefixes
- Shape names use PascalCase
- Member names use camelCase
- Names are descriptive and domain-appropriate
- No unclear abbreviations

**Flag:**

- snake_case usage (database_id)
- Generic names (GenericRequest, Data, Info)
- Unclear abbreviations (usr, tmp, cfg)
- Inconsistent naming patterns

### 3. Documentation Quality

**Ensure:**

- All public shapes have a `///` doc comment or `@documentation`, never both on one shape
- Documentation explains purpose and usage
- Constraints and validation rules are documented
- Business logic and edge cases are explained
- Units are specified for numeric values
- Examples provided where helpful

**Flag:**

- Missing documentation on public shapes
- A mixin whose documentation or other traits do not suit every shape that uses it: mixin traits copy to those shapes unless listed in `localTraits`
- Vague or unhelpful descriptions
- Undocumented constraints
- Missing units for measurements

### 4. Type Safety and Constraints

**Verify:**

- Appropriate shape types used (not everything is String)
- @required applied to mandatory fields
- @range applied to numeric bounds
- @length applied to strings and collections
- @pattern used for format validation
- `@sensitive` marks passwords, tokens, PII, on the shape a member targets (the trait cannot go on a member)
- `enum` shapes used for fixed value sets, and `intEnum` members each carry an explicit `@enumValue`

**Flag:**

- Missing @required on mandatory fields
- Unconstrained strings (no @length or @pattern)
- Unconstrained numbers (no @range)
- Overly generic types (Document everywhere)
- Missing `@sensitive` on sensitive data, or `@sensitive` placed on a member
- The deprecated `@enum` trait instead of an `enum` shape

### 5. Operation Design

**Check:**

- Operations are focused and single-purpose
- `@http` applied to every operation, and the behavior traits `@readonly` and `@idempotent` where they fit
- Every `@httpLabel` member is `@required`
- Clear input/output structures defined
- All error cases covered
- Appropriate HTTP methods used
- URI patterns follow REST conventions

**Flag:**

- Operations doing multiple things
- Missing HTTP traits
- Inconsistent URI patterns
- Wrong HTTP methods (GET for mutations)
- Missing or incomplete error definitions

### 6. Error Handling

**Ensure:**

- Specific error types defined (not GenericError)
- @error("client") for 4xx errors
- @error("server") for 5xx errors
- @httpError with appropriate status codes
- Error structures include helpful context
- All failure scenarios covered

**Flag:**

- Generic or vague error types
- Missing error definitions on operations
- Incorrect HTTP status codes
- Missing error context fields
- Inconsistent error handling patterns

### 7. Pagination

**Verify:**

- List operations have the `@paginated` trait, either directly or inherited from the service's `@paginated` (operation settings override the service's)
- `inputToken`, `outputToken`, `pageSize`, and `items` defined
- The `inputToken` member is not `@required`
- Only one list or map per operation is paginated
- Appropriate default and max page sizes

**Flag:**

- List operations without pagination
- Missing pagination tokens, or no `items` naming the paged collection
- Unreasonable page size limits
- Inconsistent pagination patterns

### 8. Security Considerations

**Check:**

- Sensitive data marked with @sensitive
- When the requirements call for authentication, the service carries an auth scheme trait (for example `@httpBearerAuth`); operations inherit it unless they set `@auth`
- Operations that must be authenticated are not marked `@optionalAuth` or `@auth([])`
- Authorization patterns documented
- Input validation prevents injection attacks
- Rate limiting considerations documented

**Flag:**

- Unmarked sensitive data (passwords, tokens, PII)
- Missing authentication requirements
- Insufficient input validation
- Security implications not documented

### 9. Code Generation Readiness

**Verify:**

- Model validates without errors
- Compatible with target code generators
- Generated code will compile
- Serialization/deserialization will work
- No breaking changes without versioning

**Flag:**

- Validation errors or warnings
- Incompatible with target generators
- Breaking changes in existing APIs, including a renamed member: `@jsonName` keeps the old JSON property name, but generated clients still see the new member name
- Missing version information

### 10. Performance and Scalability

**Consider:**

- Efficient data structures used
- Pagination for large result sets
- Streaming for large payloads
- Caching strategies via traits
- Appropriate collection types

**Flag:**

- Unbounded result sets
- Inefficient data structures
- Missing streaming for large data
- No caching considerations

### 11. File Organization and Structure

When the model spans more than one file or may need splitting, open the `smithy-modeling` skill's `smithy-modeling/references/file-organization.md` for the review checks and the layouts to recommend. Skills install side by side, so it sits next to this skill's directory.

## Review Process

### Step 1: Initial Validation

Run automated checks from the project directory, where `smithy validate` picks up `smithy-build.json` and its `sources` and Maven dependencies:

```bash
smithy validate
smithy validate --severity NOTE   # also report NOTE events; the default floor is WARNING
```

Review validation output for:

- ERROR-level issues (must fix)
- DANGER-level issues (must fix or suppress with a reason: an unsuppressed DANGER makes the model invalid)
- WARNING-level issues (should fix)
- NOTE-level suggestions (consider)

### Step 2: Structural Review

Examine model structure:

- Service definition completeness
- Operation organization
- Shape hierarchy and relationships
- Namespace organization

### Step 3: Best Practices Check

Verify adherence to:

- Naming conventions
- Documentation standards
- Type safety patterns
- Error handling consistency
- Security practices

### Step 4: Code Generation Test

Verify generated artifacts:

- Run code generation for target languages
- Check that generated code compiles
- Verify type safety in generated code
- Test serialization/deserialization

### Step 5: Breaking Change Analysis

Look for an earlier version of the model before you start: other `*.smithy` files outside the model under review (for example `previous-model/`), or the file in git history. A rename that looks like a naming nit is a wire break when a deployed version exists, so compare against it whenever one is there, by reading if the CLI is missing:

```bash
smithy diff --old previous-model/ --new current-model/
smithy diff --mode git              # compare the working tree's model against HEAD
smithy diff --mode git --old main   # or against a branch or commit
```

Identify and document:

- Breaking changes requiring version bump
- Backward-compatible additions
- Deprecations needing migration path

## Output Format

Use the Quality Gate's three levels and add what the model does well. Give every finding, SUGGESTION included, its location, impact and a Smithy example. Write fixes as complete Smithy 2.0 the reader can paste: include the `use` lines the fix needs and the full trait arguments, and avoid `{ ... }` elisions. If the smithy CLI was not run, say so in the report and list the commands to run before handoff.

### CRITICAL (Must Fix)

```
**[Category]** - [Location]
Issue: [Description]
Impact: [Why this matters]
Fix: [Specific recommendation]
Example: [Code showing fix]
```

### IMPORTANT (Should Fix)

```
**[Category]** - [Location]
Issue: [Description]
Recommendation: [Suggested improvement]
Example: [Code showing improvement]
```

### SUGGESTION (Consider)

```
**[Category]** - [Location]
Observation: [What could be better]
Benefit: [Why this would help]
Alternative: [Optional approach]
Example: [Code showing the alternative]
```

### Positive Findings

```
**[Category]**
Good practice: [What's done well]
```

## Example Review Output

Open `references/example-review.md` (relative to this file) before writing the review report. It reviews a WeatherService model and shows CRITICAL, IMPORTANT, SUGGESTION, and positive findings in that format.

## Anti-Patterns to Flag

### Design Anti-Patterns
- Overly generic shapes (GenericRequest with Document)
- Missing constraints on primitives
- Inconsistent error handling
- Missing pagination on lists
- Exposing internal implementation details
- Breaking changes without versioning

### Code Smells
- Repeated shape definitions (should be reusable)
- Inconsistent naming patterns
- Missing or poor documentation
- Overly nested structures
- Unused shapes or operations

### Security Issues
- Unmarked sensitive data
- Missing input validation
- Insufficient error context (information leakage)
- Missing authentication requirements

## Validation Checklist

Before approving a model:

- [ ] Validates without errors: `smithy validate`
- [ ] All public shapes have documentation
- [ ] Operations have defined errors
- [ ] Constraints applied (@required, @range, @length, @pattern)
- [ ] Sensitive data marked with @sensitive
- [ ] List operations support pagination
- [ ] Naming conventions followed consistently
- [ ] Generated code compiles successfully
- [ ] No breaking changes (or properly versioned)
- [ ] Security considerations addressed
- [ ] File organization appropriate for model size
- [ ] Related shapes logically grouped
- [ ] Performance implications considered

## Interaction Guidelines

1. **Be Specific**: Point to exact locations and provide concrete examples
2. **Explain Impact**: Help understand why issues matter
3. **Provide Solutions**: Don't just identify problems, suggest fixes
4. **Prioritize Issues**: Distinguish critical from nice-to-have
5. **Acknowledge Good Practices**: Recognize what's done well
6. **Consider Context**: Understand project constraints and requirements

## Quality Gate

**CRITICAL (must fix):**

- Model fails `smithy validate` with ERROR-level or unsuppressed DANGER-level events
- An operation that needs authentication can be called without it: no auth scheme trait on the service, or the operation is marked `@optionalAuth` or `@auth([])`
- Credentials, payment data (card numbers, payment tokens), government IDs or passwords not marked with `@sensitive`. Free text and ordinary IDs (notes, customer IDs) are IMPORTANT unless the model says they hold PII
- Breaking changes introduced to existing operations
- Invalid Smithy syntax that blocks code generation

**IMPORTANT (should fix):**

- Inconsistent naming conventions across shapes
- Missing error documentation
- List operations without pagination support
- Generated code for a target language does not compile (CRITICAL if the design requires that target)

**SUGGESTION:**

- Could add deprecation notices for planned removals
- Could strengthen input validation constraints

A model passes review when no CRITICAL finding remains and each IMPORTANT finding is fixed or accepted with a recorded reason.

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
