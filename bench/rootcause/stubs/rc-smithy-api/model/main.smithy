$version: "2"
namespace example.library
service LibraryLending {
    version: "1"
}
operation A {}
operation B {}
operation C {}
operation D {}
operation E {}
operation F {}
operation G {}
operation H {}
@paginated
@idempotencyToken
@readonly
@httpBearerAuth
@error("client")
@httpError(404)
@length
@pattern
@range
@required
@http
@httpLabel
resource Book {}
