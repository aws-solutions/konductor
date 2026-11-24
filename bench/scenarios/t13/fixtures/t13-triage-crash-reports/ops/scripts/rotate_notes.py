from pathlib import Path

for note in Path("ops/notes").glob("*.md"):
    print(note.name)
