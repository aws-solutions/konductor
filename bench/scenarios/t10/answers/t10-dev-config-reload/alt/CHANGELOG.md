# Changelog

## 1.6.2 - 2024-10-21

- Fixed shutdown handling when the queue is empty.

## 1.7.0 - 2024-12-03

- Added the priority lane to the delivery queue.
- Documented the partner replay procedure.

## 1.8.0 - 2025-02-14

- Added queue age and worker saturation metrics.
- Reduced noisy probe logs.

## Unreleased

- Added validated configuration reload on SIGHUP and debounced file changes. Accepted snapshots are swapped atomically, invalid candidates keep the last good settings, and jobs use one configuration view for their full run.
