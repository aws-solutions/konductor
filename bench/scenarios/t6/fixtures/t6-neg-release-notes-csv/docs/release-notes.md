# Mobile Banking App - Release Notes

## Version 6.2.0 - 2024-02-15

### New Features
- Introduced biometric login for iOS and Android devices
- Added Quick Transfer feature to send money with just 3 taps
- Implemented spending categorization with custom tags
- Launched investment portfolio dashboard for brokerage accounts

### Improvements
- Enhanced transaction search with date range filters
- Improved bill payment scheduling interface
- Optimized app startup time by 40% on Android devices
- Updated security certificates for all API endpoints

### Bug Fixes
- Fixed crash when viewing statements older than 2 years
- Resolved synchronization issue with joint accounts
- Corrected currency conversion rates for GBP to EUR
- Fixed push notification delay on iOS 17.3

## Version 6.1.3 - Jan 28, 2024

### Improvements
- Reduced app size by 15% through asset optimization
- Added support for dark mode system synchronization
- Improved accessibility for screen readers

### Bug Fixes
- Fixed login timeout after biometric failure
- Resolved calendar sync issue with scheduled payments
- Corrected display of account nicknames with special characters

## Version 6.1.2 - 2024-01-15

### Bug Fixes
- Fixed transaction duplication when network connection is lost
- Resolved incorrect balance display during scheduled transfers
- Fixed PDF export formatting for statements with many transactions

## Version 6.1.1 - 2024-01-10

### Security Updates
- Patched vulnerability in QR code scanner library
- Updated SSL/TLS configuration for enhanced encryption
- Added additional fraud detection checks for wire transfers

### Bug Fixes
- Fixed crash when deleting multiple payees at once
- Resolved issue with contact import from device address book

## Version 6.1.0 - 2023-12-20

### New Features
- Launched peer-to-peer payments via QR codes
- Added travel mode to temporarily disable certain features abroad
- Introduced savings goals with progress tracking

### Improvements
- Redesigned account overview dashboard
- Added transaction export to CSV and Excel formats
- Improved error messages for failed transactions

### Bug Fixes
- Fixed incorrect interest calculation display for CDs
- Resolved duplicate push notifications for bill reminders
- Fixed calendar integration with Google Calendar

## Version 6.0.5 - 2023-11-30

### Bug Fixes
- Fixed critical security issue with session management
- Resolved crash when loading very large transaction history
- Fixed display issue with accounts containing "quotes, commas, and other punctuation" in their names

### Improvements  
- Added loading indicators for all data fetch operations
- Improved offline mode error messages

## Version 6.0.4 - 2023-11-15

### Security Updates
- Updated encryption libraries to latest versions
- Added additional authentication checks for high-value transfers

### Bug Fixes
- Fixed issue where some users couldn't update their contact information
- Resolved sync problem between web and mobile app versions
- Fixed display of international transaction fees

### Documentation
- Updated user guide with new feature explanations
- Added troubleshooting section for common issues

## Version 5.9.0 - 2023-10-25

### New Features
- Launched budgeting tool with customizable categories
- Added ability to split bills with multiple people
- Introduced financial health score calculation

### Improvements
- Enhanced transaction categorization accuracy
- Improved performance on older Android devices
- Added support for additional bank account types

### Bug Fixes
- Fixed calculation error in loan payment estimator
- Resolved display issue with joint account permissions
- Fixed export functionality for transaction history

*Note: Version 5.8.x series was skipped due to major refactoring*

## Version 5.7.2 - 2023-09-18

### Bug Fixes
- Fixed memory leak in transaction loading
- Resolved crash when switching between accounts quickly
- Fixed display of foreign currency symbols

### Security Updates
- Implemented additional rate limiting on login attempts
- Updated certificate pinning for API calls

## Version 5.7.1 - 2023-09-05

### Improvements
- Optimized image loading for faster dashboard display
- Added caching for frequently accessed account data
- Improved error recovery during network interruptions

### Bug Fixes
- Fixed issue with scheduled transfers on weekends
- Resolved problem with check deposit photo capture
- Fixed display of account balances during maintenance windows

## Changelog Policy

This document follows our release notes format guidelines. Each version includes:
1. Version number and release date
2. Categorized changes (New Features, Improvements, Bug Fixes, Security Updates)
3. Clear, concise descriptions of what changed
4. Reference to relevant documentation updates

For major releases (x.0.0), additional sections may include:
- Migration notes for deprecated features
- Known issues and workarounds
- Performance impact assessment

---

*Last updated: 2024-02-20*