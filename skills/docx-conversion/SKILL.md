---
name: docx-conversion
description: Converts Word (.docx) files to and from Markdown with pandoc. Use when the user hands you a .docx file to read or edit, or asks for the result as a .docx file.
version: 1.0.0
tags: [skill, documents, docx, pandoc, word]
---

# DOCX Conversion

## Reading .docx Files

Convert .docx to markdown for processing:

```bash
pandoc "input.docx" -t markdown -o "output.md"
```

Or read directly to stdout:

```bash
pandoc "input.docx" -t markdown
```

After conversion, work with the markdown content normally.

## Writing .docx Files

Convert markdown to .docx when the user wants Word output:

```bash
pandoc "input.md" -o "output.docx"
```

With a reference template for consistent styling:

```bash
pandoc "input.md" --reference-doc="template.docx" -o "output.docx"
```

## Workflow

1. If the user provides a .docx file, convert to markdown first
2. Process the content as markdown
3. If the user wants .docx output, convert back using pandoc
4. If pandoc is not installed, inform the user: `brew install pandoc` (macOS) or `sudo yum install pandoc` (AL2)

## Quality Gate

**CRITICAL:**

- Never modify the original .docx file without user confirmation
- Always verify pandoc is available before attempting conversion

**IMPORTANT:**

- Preserve document structure (headings, lists, tables) during conversion
- Warn the user if complex formatting (images, charts) may be lost in conversion
