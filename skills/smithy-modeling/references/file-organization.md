# Smithy file organization

Read this when a model spans more than one file, or when deciding whether to split one.

## Single file or multiple files

**Single file** fits when:

- The API has fewer than 10 operations
- The operations and data structures are tightly coupled
- It's a prototype, proof of concept, or MVP
- The team is small (1-2 developers)

**Multiple files** fit when:

- The API has 10+ operations
- It spans multiple domains or resource types
- Several services share types
- Developers edit the model in parallel
- Code reviews need a clear separation of concerns

Start with one file. Split when:

1. The file passes 500 lines
2. Several developers edit it at the same time
3. Clear domain boundaries emerge
4. Shared types need reuse across services

## Layouts

By shape kind:

```
model/
├── service.smithy           # Service definition and metadata
├── operations.smithy        # Operation definitions
├── inputs.smithy            # Input structures
├── outputs.smithy           # Output structures
├── errors.smithy            # Error definitions
├── types.smithy             # Common types (enums, custom types)
└── validators.smithy        # Validation metadata
```

By domain:

```
model/
├── service.smithy           # Service definition
├── user/
│   ├── operations.smithy    # User-related operations
│   ├── types.smithy         # User data structures
│   └── errors.smithy        # User-specific errors
├── todo/
│   ├── operations.smithy    # Todo-related operations
│   ├── types.smithy         # Todo data structures
│   └── errors.smithy        # Todo-specific errors
└── common/
    ├── types.smithy         # Shared types
    └── errors.smithy        # Common errors
```

## What goes in each file

Every file repeats `$version: "2"` and a `namespace`. Shapes in one namespace resolve each other across files with no imports, so file order doesn't matter. Types and errors that another service will reuse go in their own namespace, such as `com.example.todo.common`, and files that need them add `use com.example.todo.common#Todo`.

`service.smithy` holds only the service shape and its metadata:

```smithy
$version: "2"

namespace com.example.todo

/// Todo Service provides task management capabilities
@title("Todo Service")
@httpBearerAuth
service TodoService {
    version: "2024-11-14"
    operations: [CreateTodo, GetTodo, UpdateTodo, DeleteTodo, ListTodos]
}
```

Use either a `///` doc comment or a `@documentation` trait on a shape, not both. A doc comment is the `documentation` trait, so both together are redundant, and two different values are a trait conflict.

`operations.smithy` holds operations and their HTTP traits:

```smithy
$version: "2"

namespace com.example.todo

/// Retrieves a specific todo item
@http(method: "GET", uri: "/todos/{todoId}")
@readonly
operation GetTodo {
    input: GetTodoInput
    output: GetTodoOutput
    errors: [TodoNotFound, UnauthorizedAccess]
}
```

`types.smithy` holds structures, enums, and other domain types (`Todo`, `Priority`). `errors.smithy` holds every `@error` structure (`TodoNotFound` with `@httpError(404)`, `ValidationError` with `@httpError(400)`).

`validators.smithy` holds validation metadata. An `EmitEachSelector` validator takes its selector under `configuration`:

```smithy
$version: "2"

metadata validators = [
    {
        name: "EmitEachSelector"
        id: "MissingDocumentation"
        message: "Every operation needs documentation"
        severity: "WARNING"
        configuration: {
            selector: "operation :not([trait|documentation])"
        }
    }
]
```

## Guidelines

**Do:**

- Name files consistently (lowercase with hyphens is this guide's convention; Smithy does not require it)
- Group related shapes in the same file, one responsibility per file
- Use one namespace for a service's own shapes, plus a separate common namespace only for shapes other services reuse
- State the file's purpose at the top and order shapes logically within it
- Keep shared types in their own file or directory so other services can reuse them

**Don't:**

- Mix unrelated concerns in one file (operations plus unrelated types)
- Create files with only 1-2 shapes (too granular)
- Define the same shape in more than one file
- Scatter one service's own shapes across several namespaces

## Build configuration

Point `smithy-build.json` at the model directory. Pin the Maven dependencies to the current release from the [Smithy releases page](https://github.com/smithy-lang/smithy/releases), and use the same version for every `software.amazon.smithy` artifact. IDL 2.1 needs 1.75.0 or later. The example pins 1.74.1, the newest release on Maven Central when this guide was checked, which does not read IDL 2.1. The `$schema` key lets editors validate the file:

```json
{
  "$schema": "https://smithy.io/2.0/_static/smithy-build-schema.json",
  "version": "1.0",
  "sources": ["model"],
  "maven": {
    "dependencies": [
      "software.amazon.smithy:smithy-aws-traits:1.74.1",
      "software.amazon.smithy:smithy-openapi:1.74.1"
    ]
  },
  "plugins": {
    "openapi": { "service": "com.example.todo#TodoService" }
  }
}
```

smithy-build adds every file in each `sources` directory tree, subdirectories included, so the domain layout needs no extra entries.

## Review checks

When validating a model, flag:

- A single file over 500 lines, or with 10+ operations, and no logical split
- Files with only 1-2 shapes
- Mixed concerns in one file
- Inconsistent file naming
- Duplicate shape definitions across files
- One service's own shapes spread across several namespaces
- No clear separation between domains, or a layout that blocks parallel work
- Shared types not separated for reuse
- `sources` in `smithy-build.json` that miss a model directory
