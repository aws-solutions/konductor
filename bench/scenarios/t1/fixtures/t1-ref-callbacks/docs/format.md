# Record format

A record has this shape:

```json
{
  "source": "note.txt",
  "lines": ["one", "two"],
  "lineCount": 2,
  "wordCount": 2,
  "characters": 8
}
```

The `characters` value counts the original UTF-8 string as JavaScript characters, including newline characters.
