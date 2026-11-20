# Add fulfilment status tracking and reporting

## What
This PR adds a new `fulfilment_status` column to the orders table to track order fulfilment separately from the general order status. It also includes a new reporting repository with methods to analyse fulfilment data.

## Why
The business team needs to track order fulfilment independently from order status. Currently, fulfilment information is mixed with order status, making it hard to generate accurate fulfilment reports. This change will enable:
- Better fulfilment tracking and reporting
- Separation of concerns between order lifecycle and fulfilment workflow
- Historical analysis of fulfilment performance

## Changes
1. **Migration 003**: Adds `fulfilment_status` column (NOT NULL) with backfill logic
2. **Report repository**: New `OrderReportRepository` with methods for:
   - Fulfilment summary statistics
   - Customer fulfilment details
   - Date-range filtering by fulfilment status
3. **Tests**: Comprehensive tests for the new migration and reporting functions

## How it was tested
- All existing tests pass
- New migration tested with up/down cycles
- Report repository tested with various data scenarios
- Integration tests verify backfill logic works correctly
- Test coverage includes edge cases and error conditions

## Notes
- The migration includes a backfill that maps existing statuses to fulfilment statuses
- The new column is NOT NULL to ensure data integrity
- Index added on `fulfilment_status` for query performance
- Down migration safely removes the column