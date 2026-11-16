// SPDX-License-Identifier: Apache-2.0
/**
 * The name rules shared by the file-format validators (formats.js) and the run layout (layout.js).
 * They live in one place so the two cannot disagree: a task id or batch name the validators accept
 * must be one the layout can build a path from, or `plan` would fail late instead of naming the file.
 *
 *   SAFE_SEGMENT  a name that may become one path segment (a task id, a seat, a run id, a skill):
 *                 starts with a letter or digit, then letters, digits, ".", "_" and "-", at most 128
 *                 characters, and no "..". It cannot be empty, hold a slash, or start with "-" or ".".
 *   SEAT_NAME     a judge seat: a SAFE_SEGMENT without ".", in lowercase, at most 64 characters.
 *                 A judgment file is named <task>.<seat>.<arm>.json, so with no "." in the seat, the last
 *                 two dots always mark the seat and two different (task, seat) pairs cannot build the same
 *                 file name. Lowercase because macOS and Windows file systems treat "A" and "a" as one file,
 *                 so two seats that differ only in case would overwrite each other's judgments. At most 64
 *                 because the longest task id (128) plus the seat, the arm and the separators must stay
 *                 under the 255-byte file name limit of APFS, ext4 and NTFS; 128 + 128 did not.
 *   BATCH_NAME    a batch name: lowercase letters, digits and "-", starting with a letter or digit,
 *                 at most 128 characters. Every BATCH_NAME is also a SAFE_SEGMENT.
 *
 * No file access; pure patterns.
 */
'use strict';

const SAFE_SEGMENT = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEAT_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const BATCH_NAME = /^[a-z0-9][a-z0-9-]{0,127}$/;

module.exports = { SAFE_SEGMENT, SEAT_NAME, BATCH_NAME };
