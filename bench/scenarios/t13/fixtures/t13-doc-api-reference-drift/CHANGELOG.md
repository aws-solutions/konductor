# Changelog

## 2.0.0 - 2025-11-14

- Accept an options object instead of positional queue arguments.
- Set defaults to 5 attempts and 200 ms.
- Remove `flush`; use `drain`.
- Deprecate `retryNow`.

## 1.4.2 - 2025-08-02

- Clarify failure callback timing.
- Improve queue shutdown behavior.

## 1.4.1 - 2025-06-19

- Fix a timer cleanup edge case.
