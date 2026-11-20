# CMX-2: a `tag` command

`shelf tag <id> <tag>` adds a tag to a book. The list already prints tags after the reading time (`#scifi #classic`).

- Tags are stored in lower case, without a leading `#`: `tag b1 #SciFi` stores `scifi`.
- It prints `b1 tagged #scifi`.
- Adding a tag the book already has changes nothing and prints `b1 already has #scifi`.
- A book has at most 5 tags. A sixth fails with the error `b1 already has 5 tags`.
- A missing id or tag fails with `usage: tag <id> <tag>`; an unknown id fails as `done` does (`no book b9`).
