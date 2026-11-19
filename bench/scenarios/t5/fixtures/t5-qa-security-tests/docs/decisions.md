# Small decisions

The handler layer returns plain objects so the HTTP adapter can choose its own response library. Keeping validation and access decisions in small modules also makes the command-line harness useful to support engineers.
