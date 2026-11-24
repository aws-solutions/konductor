# ISSUE-406: Web upload fails over 10 MB
Reporter: Priya N.
Date: 2026-04-14

The web uploader rejects files larger than 10 MB with a generic error. Smaller files complete normally, so splitting a file is possible for now.

Environment: Chrome 124 on Windows 11; release 1.8.1; 12 MB PDF

Comments:
- The same file uploads when split into two parts.

Reactions: 8
