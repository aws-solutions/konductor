# Architecture

```
raw request -> normalize -> match route -> handler -> response
                                   |             |
                                 404           HttpError -> status, other errors -> 500
```

The gateway keeps no state between requests. Everything a handler needs is in the normalized request
and the context object. Time comes from the injected clock so tests never sleep.
