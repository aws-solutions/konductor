# Example Review Output

Read this before writing a review report: it is the Output Format in `SKILL.md` filled in for a real model.

````markdown
## Smithy Model Review: WeatherService

### CRITICAL

**Type Safety** - WeatherData.temperature
Issue: Temperature field is untyped String without constraints
Impact: Allows invalid values, breaks type safety in generated code
Fix: Define specific type with validation
Example:

```smithy
@documentation("Temperature in Celsius. Range: -273.15 to 1000")
@range(min: -273.15, max: 1000)
Double TemperatureCelsius
```

**Error Handling** - GetForecast operation
Issue: Only defines GenericError, missing specific error types
Impact: Clients can't handle different failure scenarios appropriately
Fix: Define specific error types for each failure case
Example:

```smithy
operation GetForecast {
    input: GetForecastInput
    output: GetForecastOutput
    errors: [
        LocationNotFound
        ServiceUnavailable
        InvalidDateRange
    ]
}
```

**Security** - WeatherService service
Issue: The service has no auth scheme trait, so every operation can be called anonymously
Impact: Anyone can read forecasts and call write operations without credentials
Fix: Put an auth scheme on the service; operations inherit it
Example:

```smithy
use aws.auth#sigv4
use aws.protocols#restJson1

@restJson1
@sigv4(name: "weather")
service WeatherService {
    version: "2024-01-01"
    operations: [GetForecast, ListLocations]
}
```

### IMPORTANT

**Documentation** - ListLocations operation
Issue: Missing documentation on pagination behavior
Recommendation: Document pagination limits and token usage
Example:

```smithy
@documentation("""
Lists available weather locations with pagination support.
Returns up to 100 locations per request. Use nextToken for additional pages.
""")
@readonly
@http(method: "GET", uri: "/locations")
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "locations")
operation ListLocations {
    input := {
        @httpQuery("nextToken")
        nextToken: String

        @httpQuery("maxResults")
        @range(min: 1, max: 100)
        maxResults: Integer
    }
    output := {
        @required
        locations: LocationList

        nextToken: String
    }
}
```

**Security** - User.email field
Issue: Email field not marked as sensitive
Recommendation: Mark PII with @sensitive trait
Example:

```smithy
structure User {
    @sensitive
    email: String
}
```

### SUGGESTION

**Performance** - ListLocations operation
Observation: No default page size specified
Benefit: Prevents accidentally large responses
Alternative: Add default value to maxResults
Example:

```smithy
structure ListLocationsInput {
    @range(min: 1, max: 100)
    maxResults: Integer = 20
}
```

**File Organization** - Single file model
Observation: Model contains 15 operations and 600+ lines in single file
Benefit: Splitting improves maintainability and enables parallel development
Alternative: Organize into logical component files
Example:

```
model/
├── service.smithy       # Service definition
├── operations.smithy    # All operations
├── types.smithy         # Data structures
└── errors.smithy        # Error definitions
```

### Positive Findings

**Naming Conventions**
All shapes follow PascalCase/camelCase conventions consistently

**Behavior Traits**
Operations properly use @readonly and @idempotent where appropriate

**Validation**
Good use of @pattern for email validation
````
