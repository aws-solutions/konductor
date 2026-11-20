# Code Review: Profile Picture Upload Feature

Overall, the feature adds needed functionality but has several security and reliability issues that must be addressed before merging. The implementation correctly handles the basic flow of file uploads and integrates with the existing user system, but misses critical security checks and has inconsistent error handling.

The most serious issue is the path traversal vulnerability that could allow attackers to write files anywhere the server has write access. Additionally, the missing file size limit bypasses configured restrictions, and trusting client-supplied Content-Type headers opens another attack vector.

## Findings

```json
[
  {
    "location": "src/forum/utils/image_helpers.py:55",
    "severity": "critical",
    "issue": "Path traversal vulnerability: original_filename is used directly in os.path.join, allowing attackers to write files outside upload directory with filenames containing '../'.",
    "fix": "Use os.path.basename() to sanitize filenames or replace path separators before joining paths."
  },
  {
    "location": "src/forum/handlers/user_handler.py:263",
    "severity": "high",
    "issue": "Missing file size limit: process_image_upload is called without the max_size parameter, bypassing the 2MB limit defined in config.MAX_UPLOAD_SIZE.",
    "fix": "Pass max_size=MAX_UPLOAD_SIZE parameter to process_image_upload() call."
  },
  {
    "location": "src/forum/utils/image_helpers.py:106",
    "severity": "medium",
    "issue": "Trusting client-supplied Content-Type: Only checking the Content-Type header without verifying the actual file content allows attackers to upload non-image files with image MIME types.",
    "fix": "Use imghdr.what() or file magic to verify actual image type, not just the Content-Type header."
  },
  {
    "location": "src/forum/utils/image_helpers.py:77",
    "severity": "low",
    "issue": "Temporary file not cleaned up on error: The temporary file created with tempfile.mkstemp() is not deleted when validation fails, potentially filling disk space with orphaned files.",
    "fix": "Add os.unlink(temp_path) in exception handler or use a context manager that guarantees cleanup."
  },
  {
    "location": "src/forum/handlers/user_handler.py:275",
    "severity": "medium",
    "issue": "User email exposed in URL: Avatar URLs include the user's email address, exposing private information in logs, caches, and referrer headers.",
    "fix": "Use user ID or a hash instead of email in the URL path, or serve files through a non-predictable endpoint."
  },
  {
    "location": "src/forum/handlers/user_handler.py:207",
    "severity": "medium",
    "issue": "Old avatar files not deleted: When users update their avatar URL, the old image file remains on disk, causing storage bloat and potential privacy issues.",
    "fix": "Before updating avatar_url, check if old file exists and delete it, or implement reference counting/garbage collection."
  },
  {
    "location": "docs/api.md:105",
    "severity": "low",
    "issue": "Documentation incorrectly claims old files are automatically deleted, but the implementation doesn't delete old avatar files when users update their avatar URL.",
    "fix": "Update documentation to reflect actual behavior or implement the promised cleanup functionality."
  }
]
```