# Operations notes

The report command is deliberately file-based. A scheduled job can archive the source JSON beside the generated output. Keep source files smaller than the configured row limit and validate them before handing them to the command.

The CI job runs the repository tests without installing packages. The vendored formatter is checked into source control for the same reason.
