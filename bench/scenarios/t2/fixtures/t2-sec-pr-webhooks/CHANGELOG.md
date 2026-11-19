# Changelog

## 2.1.0 (2024-11-15)

### Added
- Generic webhook receiver with configurable signature validation
- Support for custom HMAC algorithms (sha256, sha512)
- Health check endpoint at `/health`

### Changed
- Improved error logging for signature verification failures
- Updated Stripe webhook handler to use latest SDK patterns

### Fixed
- Memory leak in long-running callback operations
- Race condition in concurrent webhook processing

## 2.0.0 (2024-10-01)

### Breaking Changes
- Migrated to ES modules
- Minimum Node.js version raised to 20.0.0

### Added
- GitHub webhook signature verification
- Rate limiting middleware

## 1.3.0 (2024-09-15)

### Added
- Initial Stripe webhook support
- Basic callback URL validation
- Request timeout configuration