# Client notes

The web shop uses the v2 response fields directly. Mobile releases 4.8 and 4.9 are still in use and read `displayName` when rendering a product card. The mobile release train updates quarterly, so response changes need a compatibility window.

Create requests may omit `subtitle`; the service stores an empty subtitle when none is supplied. Mobile clients send `labels` as a short list and preserve the values returned by the API.
