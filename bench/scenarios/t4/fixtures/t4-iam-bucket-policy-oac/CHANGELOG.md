# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2024-11-15

### Added
- CloudFront CDN integration for both staging and production
- New CDN configuration file at `infra/cdn-config.json`
- Deploy script supports CDN cache invalidation
- Architecture documentation

### Changed
- Updated bucket names to include environment suffix
- Modified deploy role policy to include CloudFront permissions
- Updated README with CDN information

### Fixed
- JSON linting script handles nested directories
- Test cleanup properly removes temp directories

## [2.0.0] - 2024-10-20

### Added
- Separate staging and production environments
- Environment-specific bucket policies
- Deploy role with S3 permissions
- Basic test suite

### Changed
- Restructured project layout
- Moved all infrastructure config to `infra/` directory
- Updated package.json scripts

### Removed
- Legacy deployment scripts
- Old bucket naming conventions

## [1.2.0] - 2024-09-05

### Added
- Initial S3 bucket configuration
- Basic deploy scripts
- Lint script for JSON validation
- README documentation

### Changed
- Standardized bucket policy format
- Improved error handling in scripts

## [1.1.0] - 2024-08-15

### Added
- Project setup with Node.js
- Initial bucket policies (public access)
- Logs bucket configuration

### Fixed  
- Correct ARN formats in policies
- Account ID placeholder values

## [1.0.0] - 2024-07-01

### Added
- Initial project creation
- Basic directory structure
- License file