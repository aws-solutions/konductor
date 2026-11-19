# Deployments

A staging push runs the verification job and then uploads the public directory before updating the API function. A tagged release follows the same order in production and requests a fresh CDN distribution invalidation after the upload.

The release identifier comes from `RELEASE_ID` in CI. Local runs use a readable fallback so their manifests are easy to inspect.
