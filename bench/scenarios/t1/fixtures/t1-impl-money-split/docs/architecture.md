# Architecture notes

The modules are intentionally narrow. Currency validates metadata, money performs arithmetic, invoice owns its balance, and ledger coordinates a collection. The CLI only translates text into those module calls.
