---
name: smithy-modeling
description: Generates Smithy API models from requirements. Use when designing a new service API. Produces service definitions, operations, data structures, validation rules, and error handling following Smithy best practices. Supports TypeScript, OpenAPI, and AWS SDK code generation.
version: 1.0.0
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

### 3. Shape Design

- Use appropriate shape types (structure, string, integer, list, map, etc.)
- Apply naming conventions (PascalCase for shapes, camelCase for members)
- Add comprehensive documentation to all public shapes
- Define reusable shapes for common patterns

### 4. Validation and Constraints

- Apply @required trait to mandatory fields
- Use @range for numeric bounds
- Apply @length for string/collection size limits
- Use @pattern for format validation (email, URLs, etc.)
- Mark passwords, tokens, and PII with @sensitive
- Put the auth scheme traits (for example `@httpBearerAuth`) on the service. Operations inherit them; use `@auth` on an operation only to narrow or reorder its schemes, and `@optionalAuth` only for operations callable without credentials

### 5. Error Handling

- Define specific error types for different failure scenarios
- Use @error("client") for 4xx errors
- Use @error("server") for 5xx errors
- Apply @httpError with appropriate status codes
- Include helpful error messages and context

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

Generate complete Smithy model files with:

```smithy
$version: "2"

namespace [appropriate.namespace]

/// Service documentation
@title("[Service Title]")
@httpBearerAuth
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
structure [OperationInput] {
    /// Field documentation
    @required
    [fieldName]: [Type]
}

/// Output structure documentation
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
- Breaking changes without versioning
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

## Interaction Guidelines

1. **Ask Clarifying Questions** if requirements are ambiguous
2. **Suggest Improvements** to API design when appropriate
3. **Explain Design Decisions** in comments or documentation
4. **Provide Multiple Options** when there are valid alternatives
5. **Consider Future Evolution** and versioning strategy

## Deliverables

Provide:

1. **Complete Smithy Model** with all shapes defined
2. **Build Configuration** (smithy-build.json) if code generation is needed
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

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
