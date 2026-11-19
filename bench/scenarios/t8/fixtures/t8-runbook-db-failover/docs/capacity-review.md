# Capacity review, January 2025

The API pool is configured for 40 connections per process. The normal range is 8 to 24. A short burst can reach the low thirties when an upstream request retries; alert thresholds are recorded in the current configuration.

The storage fleet uses encrypted NVMe volumes. Routine maintenance windows include filesystem checks and volume snapshots. This document is a capacity snapshot and does not replace the current topology or alert catalogue.
