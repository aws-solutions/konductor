# Front-end review: signup-ui

Scope: `src/api.ts`, `src/useUsers.ts`, `src/UserTable.tsx`, `src/SignupForm.tsx`, checked against the conventions in `README.md`. Nothing was changed.

## Critical

### 1. User-supplied name rendered as HTML (src/UserTable.tsx:11)

`displayName` goes into `dangerouslySetInnerHTML`. Any user can register a name containing a script tag, and every viewer of the list runs it: stored XSS. Fix: render `{u.displayName}` as text. If rich text is ever needed, sanitize on the server and in the client.

### 2. Password logged and visible (src/SignupForm.tsx:15 and src/SignupForm.tsx:24)

`console.log('signup', { email, password })` writes the credential to the browser console and to any log collector. The password input has `type="text"`, so it is readable on screen. Fix: delete the log line and use the Cloudscape Input with `type="password"`.

## Important

### 3. Native elements instead of Cloudscape (src/SignupForm.tsx:22-26, src/UserTable.tsx:7-10)

The form uses `<form>`, `<input>` and `<button>`, and the list uses `<table>`. The README allows Cloudscape components only. Fix: Form, FormField, Input and Button for the form, Table for the list.

### 4. `any` in props, state and API results (src/api.ts:1, src/api.ts:6, src/useUsers.ts:5, src/UserTable.tsx:3, src/SignupForm.tsx:9)

`Promise<any>`, `any[]`, `(u: any)` and `e: any` turn off type checking across the data path. Fix: define `User` and `NewUser` types, type the API functions with them, and type the handler event.

### 5. Data hook ignores its input and never cleans up (src/useUsers.ts:8-14)

The effect reads `query` but its dependency array is empty, so changing the query never reloads and the list goes stale. There is no abort or ignore flag, so a slow earlier response can overwrite a later one and state is set after unmount. A rejected fetch leaves `loading` true forever. Fix: depend on `[query]`, use an AbortController or a cancelled flag in the cleanup, and add an error state.

### 6. Accessibility (src/SignupForm.tsx:23-25, src/UserTable.tsx:10)

The inputs have a placeholder and no label, so screen readers have no name for them. The error text sits in a plain `div` and is not announced. The table row has an `onClick` but no role, focus or key handler, so keyboard users cannot select a user. Fix: FormField labels, an Alert for errors, and a selectable Table.

### 7. Errors swallowed, responses unchecked (src/SignupForm.tsx:18, src/api.ts:2-3, src/api.ts:7-8)

The submit handler has an empty `catch`, so a failed sign-up looks like success. The fetch wrappers never check `res.ok`, send JSON without a content type, and build the query string by concatenation without URL encoding. Fix: check `res.ok` and throw, set the content type, use `encodeURIComponent`, and show the error to the user.

## Minor

### 8. Hand-written validation (src/SignupForm.tsx:11)

The email check is `indexOf('@')` with one generic message. The README asks for a Zod schema. Fix: one schema for email and password with per-field messages.

### 9. Array index as list key (src/UserTable.tsx:10)

`key={i}` breaks row identity when the list is reordered or filtered. Use the user id.

### 10. Inline styles and literal colors (src/SignupForm.tsx:25, src/UserTable.tsx:7)

`style={{ color: 'red' }}` and a hex border color bypass design tokens. Use Cloudscape components and tokens.

## Summary

Two critical findings (XSS, credential exposure), five important, three minor. Fix the two critical items first, then move the form and table to Cloudscape components, which also resolves most of the accessibility and validation findings.
