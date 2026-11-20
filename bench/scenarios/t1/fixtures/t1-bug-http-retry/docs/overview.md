# Overview

The client is intentionally narrow. It makes one HTTP request, collects the
response body as UTF-8 text, and returns plain data to callers. Applications
own authentication and domain-specific error handling.

The request URL may use `http:` or `https:`. The transport is selected from
the URL rather than from an application-wide setting.
