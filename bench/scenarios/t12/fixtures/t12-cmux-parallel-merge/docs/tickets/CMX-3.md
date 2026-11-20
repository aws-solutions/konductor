# CMX-3: a `stats` command

`shelf stats` prints one line about the whole shelf:

```
books: 3, read: 1, left: 6h 5m
```

- `books` counts every book, `read` the ones marked done.
- `left` is the reading time of the books not yet read, added up and written the way the list writes reading times.
- An empty shelf prints `books: 0, read: 0, left: 0m`.
- Arguments after `stats` are ignored.
