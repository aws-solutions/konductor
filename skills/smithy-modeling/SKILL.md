---
name: smithy-modeling
description: Generates Smithy API models from requirements. Use when designing a new service API. Produces service definitions, operations, data structures, validation rules, and error handling following Smithy best practices. Supports TypeScript, OpenAPI, and AWS SDK code generation.
version: 1.1.0
tags: [skill, smithy, api-design, type-safety, code-generation, aws]
---

# Smithy Modeling

## Overview

Generates type-safe Smithy models from requirements, design documents, user stories, or existing API specifications. Covers service definitions, operations, input/output shapes, validation traits, error types, and pagination. Every shape must stay compatible with TypeScript, OpenAPI, and AWS SDK code generation.

## Usage

Use this skill when:

- Designing a new service API before implementation
- Creating API contracts for client/server code generation
- Defining data structures and validation rules

## Model Elements

### 1. Service Definition

- Define service shape with appropriate metadata
- Set the service version, a date string such as `"2024-01-15"` as in the template below
- Include title and documentation
- List all operations the service provides

### 2. Operation Modeling

- Create focused, single-purpose operations
- Define clear input/output structures
- Apply appropriate HTTP traits (@http, @readonly, @idempotent)
- Specify all possible errors for each operation
- A POST that creates something or changes state (create, check out, submit) is not idempotent. Give its input an `@idempotencyToken` member so clients can retry a timed-out call without doing the work twice, or say in the operation docs why a retry is unsafe

### 3. Shape Design

- Use appropriate shape types (structure, string, integer, list, map, etc.)
- Apply naming conventions (PascalCase for shapes, camelCase for members)
- Add comprehensive documentation to all public shapes
- Define reusable shapes for common patterns. When create, replace, and read shapes repeat the same members, put them in a `@mixin` (see Common Patterns)
- When another service will reuse types or errors, put them in their own namespace (for example `com.example.library.common`) and pull them in with `use`, so the second service imports them instead of copying

### 4. Validation and Constraints

- Apply @required trait to mandatory fields
- Use @range for numeric bounds
- Apply @length for string/collection size limits
- Use @pattern for format validation (email, URLs, etc.)
- Mark passwords, tokens, and PII with @sensitive
- When the requirements call for authentication, put the auth scheme trait (for example `@httpBearerAuth`) on the service. Operations inherit it; use `@auth` on an operation only to narrow or reorder its schemes, and `@optionalAuth` only for operations callable without credentials. Don't add a scheme the input never asked for, since it changes every generated client; list it as a suggestion instead

### 5. Error Handling

- Define specific error types for different failure scenarios
- Use @error("client") for 4xx errors
- Use @error("server") for 5xx errors
- Apply @httpError with appropriate status codes
- Include helpful error messages and context, for example a `fieldErrors` list on `ValidationError` naming each bad field and why
- Mark errors a client may retry with `@retryable` (`@retryable(throttling: true)` for 429), and give throttling and 503 errors a `Retry-After` `@httpHeader`
- Attach errors to the operations that can raise them. Errors any operation can raise (throttling, 503) go in the service's `errors` list instead

### 6. Pagination Support

- Apply @paginated trait to list operations
- Define inputToken, outputToken, and pageSize
- Create appropriate pagination structures

## Input Processing

When given requirements or specifications:

1. **Identify Service Boundaries**: Determine service name, version, and scope
2. **Extract Operations**: List all API operations needed
3. **Model Data Structures**: Identify input/output shapes and their relationships
4. **Define Validation Rules**: Extract constraints from requirements
5. **Map Error Scenarios**: Identify failure cases and appropriate error types
6. **Consider Code Generation**: Ensure model supports target languages (TypeScript, OpenAPI, etc.)

## Output Format

If step 2 found 10 or more operations, the model will pass 500 lines, or other services share its types, open `references/file-organization.md` (relative to this file) before writing files and split the model the way it shows. Otherwise write one file in this shape. `aws.protocols#restJson1` comes from the `software.amazon.smithy:smithy-aws-traits` package, so the model needs a `smithy-build.json` that lists it (see Deliverables) or `smithy validate` can't resolve the trait:

```smithy
$version: "2"

namespace [appropriate.namespace]

use aws.protocols#restJson1

/// Service documentation
@title("[Service Title]")
@restJson1
service [ServiceName] {
    version: "[YYYY-MM-DD]"
    operations: [
        [Operation1]
        [Operation2]
    ]
}

/// Operation documentation
@http(method: "[METHOD]", uri: "[/path/{param}]")
@readonly  // if applicable
operation [OperationName] {
    input: [OperationInput]
    output: [OperationOutput]
    errors: [
        [Error1]
        [Error2]
    ]
}

/// Input structure documentation
@input
structure [OperationInput] {
    /// Field documentation
    @required
    [fieldName]: [Type]
}

/// Output structure documentation
@output
structure [OperationOutput] {
    /// Field documentation
    [fieldName]: [Type]
}

/// Error documentation
@error("client")
@httpError(404)
structure [ErrorName] {
    @required
    message: String
}
```

## Best Practices to Follow

### Naming Conventions

- Service names: PascalCase (e.g., WeatherService)
- Operation names: PascalCase verbs (e.g., GetForecast, CreateUser)
- Shape names: PascalCase nouns (e.g., UserProfile, WeatherData)
- Member names: camelCase (e.g., userId, temperatureCelsius)
- Use descriptive, domain-specific names

### Documentation Standards

- Document all public shapes with a `///` doc comment or `@documentation`, not both on one shape
- Explain constraints and validation rules
- Document business logic and edge cases
- Provide examples where helpful
- Describe units for numeric values

### Type Safety

- Avoid overly generic shapes (Document, String for everything)
- Create specific types for domain concepts
- Use enums for fixed value sets
- Apply appropriate constraints to all fields

### Error Design

- Create specific error types, not generic ones
- Include context fields in error structures
- Use appropriate HTTP status codes
- Distinguish between client and server errors

### Code Generation Readiness

- Ensure models work with target code generators
- Consider TypeScript, OpenAPI, and AWS SDK generation
- Test that generated code compiles
- Verify serialization/deserialization works correctly

## Common Patterns

### CRUD Operations

```smithy
@http(method: "POST", uri: "/users")
operation CreateUser {
    input: CreateUserInput
    output: CreateUserOutput
    errors: [ValidationError, ConflictError]
}

@input
structure CreateUserInput with [UserAttributes] {
    /// Lets a client retry a timed-out create without creating a second user
    @idempotencyToken
    clientToken: String
}

@http(method: "GET", uri: "/users/{userId}")
@readonly
operation GetUser {
    input: GetUserInput
    output: GetUserOutput
    errors: [UserNotFound, UnauthorizedAccess]
}

@http(method: "PUT", uri: "/users/{userId}")
@idempotent
operation UpdateUser {
    input: UpdateUserInput
    output: UpdateUserOutput
    errors: [UserNotFound, ValidationError]
}

@http(method: "DELETE", uri: "/users/{userId}")
@idempotent
operation DeleteUser {
    input: DeleteUserInput
    output: DeleteUserOutput
    errors: [UserNotFound]
}
```

### Shared Members with a Mixin

```smithy
/// Fields a caller sets on create and full replace
@mixin
structure UserAttributes {
    @required
    email: Email

    displayName: String
}

structure User with [UserAttributes] {
    @required
    userId: String
}
```

### Common Errors

```smithy
@error("client")
@httpError(400)
structure ValidationError {
    @required
    message: String

    /// One entry per invalid field
    fieldErrors: FieldErrorList
}

structure FieldError {
    @required
    field: String

    @required
    reason: String
}

list FieldErrorList {
    member: FieldError
}

@error("client")
@httpError(429)
@retryable(throttling: true)
structure ThrottlingError {
    @required
    message: String

    /// Seconds to wait before retrying
    @httpHeader("Retry-After")
    retryAfterSeconds: Integer
}

@error("server")
@httpError(503)
@retryable
structure ServiceUnavailableError {
    @required
    message: String
}
```

### Paginated Lists

```smithy
@http(method: "GET", uri: "/users")
@readonly
@paginated(
    inputToken: "nextToken"
    outputToken: "nextToken"
    pageSize: "maxResults"
)
operation ListUsers {
    input: ListUsersInput
    output: ListUsersOutput
}

structure ListUsersInput {
    @httpQuery("maxResults")
    @range(min: 1, max: 100)
    maxResults: Integer = 20

    @httpQuery("nextToken")
    nextToken: String
}

structure ListUsersOutput {
    @required
    users: UserList

    nextToken: String
}
```

### Validation Patterns

```smithy
@pattern("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$")
string Email

@range(min: 0, max: 150)
integer Age

@length(min: 8, max: 128)
string Password

@length(min: 1, max: 100)
list UserList {
    member: User
}
```

## What to Avoid

### Anti-Patterns

- Overly generic shapes (GenericRequest with Document field)
- Missing constraints on strings and numbers
- Inconsistent error handling across operations
- Missing documentation on public shapes
- Breaking changes without versioning. Renaming a member changes its JSON wire name, so when you fix an existing model, say in the change notes whether any clients depend on it, and keep the old wire name with `@jsonName` if they do
- Missing pagination on list operations
- Exposing internal implementation details
- Using snake_case instead of camelCase

### Common Mistakes

- Forgetting @required on mandatory fields
- Not defining specific error types
- Missing @sensitive on passwords, tokens, PII
- Inconsistent naming conventions
- Overly nested structures
- Missing HTTP traits on operations
- Not considering code generation targets

## File Organization

Keep a model under 10 operations in one file; split it at 10+ operations, past 500 lines, or when several services share its types.

Open `references/file-organization.md` (relative to this file) when a model spans more than one file or you are deciding whether to split one. It has the file layouts, what goes in each file, the `smithy-build.json` sources setup, and the review checks `smithy-validation` applies.

## Reviewing an Existing Model

When asked to review or fix a model, check it against the Quality Gate below, fix what it asks for, and stay within what the model already does: no new operations or auth schemes the original didn't imply. Report the changes under CRITICAL, IMPORTANT, and SUGGESTION headings in that order, and note any change that alters the wire format.

## Interaction Guidelines

1. **Ask Clarifying Questions** if requirements are ambiguous
2. **Suggest Improvements** to API design when appropriate
3. **Explain Design Decisions** in comments or documentation
4. **Provide Multiple Options** when there are valid alternatives
5. **Consider Future Evolution** and versioning strategy

## Deliverables

Provide:

1. **Complete Smithy Model** with all shapes defined
2. **Build Configuration** (smithy-build.json) whenever the model uses an `aws.*` trait such as `aws.protocols#restJson1` or code generation is needed. List `software.amazon.smithy:smithy-aws-traits` under `maven.dependencies` for `aws.*` traits. For a split model, list every file under `sources` as `references/file-organization.md` shows
3. **Validation Metadata** for linting and quality checks
4. **Documentation** explaining design decisions
5. **Example Usage** showing how to use generated code

## Quality Gate

**CRITICAL (must fix):**

- Model fails `smithy validate`
- Service namespace missing or not a valid reverse-DNS namespace
- Operations missing required `@http` traits
- Error shapes not defined for failure cases
- Input/output shapes missing required members

**IMPORTANT (should fix):**

- Missing documentation (`///` comments or `@documentation`) on operations and shapes
- Pagination not implemented for list operations
- Validation constraints (`@length`, `@range`, `@pattern`) missing on string/numeric inputs
- Passwords, tokens, or PII not marked `@sensitive`
- Naming conventions applied inconsistently
- Generated code for a target language does not compile

**SUGGESTION:**

- Could add `@examples` traits for documentation
- Could define reusable common shapes (timestamps, IDs)

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]", unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
