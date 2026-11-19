# Architecture

The browser receives immutable files from object storage through a CDN. The small API is a regional function with a named alias. The deploy tool owns the release ordering and leaves resource provisioning to infrastructure automation.
