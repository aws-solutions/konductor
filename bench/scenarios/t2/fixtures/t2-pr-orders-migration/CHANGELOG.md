# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.1] - 2024-11-15
### Fixed
- Fixed index creation race condition in migration runner
- Improved error messages for constraint violations

## [2.3.0] - 2024-11-01
### Added
- Support for partial order updates
- New order validation middleware
- Migration dry-run mode

## [2.2.0] - 2024-10-15
### Added
- Order archiving functionality
- Performance optimizations for large queries
- Added database connection pooling

## [2.1.0] - 2024-09-20
### Added
- Initial order reporting system
- Basic migration framework
- Repository pattern implementation

## [2.0.0] - 2024-08-10
### Added
- Initial release of order service
- SQLite-based storage
- Basic CRUD operations