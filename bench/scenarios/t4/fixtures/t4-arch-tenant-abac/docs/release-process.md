# Release process

1. Update the version and changelog entry.
2. Run the built-in test suite on Node.js 24.
3. Run the tenant catalog consistency check.
4. Review the generated policy diff and the deployment resource names.
5. Publish the artifact through the normal change window.

The repository has no install step and no runtime package dependencies.
