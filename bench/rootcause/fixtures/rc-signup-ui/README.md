# signup-ui

A small React and TypeScript front end for account sign-up and a user list.

## Conventions

- UI is built from Cloudscape components only (Button, Form, FormField, Input, Table, Alert, Box). No native form controls or tables.
- Props, state and API results have explicit types. No `any`.
- Forms are validated with a Zod schema, and every field has a visible label.
- Errors are shown to the user in an Alert and are announced to screen readers.
- Data fetching lives in hooks, honors the hook's inputs and cancels on unmount.
- Never render user-supplied text as HTML. Never log credentials.
- Colors and spacing come from design tokens, not hex values.

## Layout

- `src/api.ts`: fetch wrappers for the REST API.
- `src/useUsers.ts`: hook that loads the user list.
- `src/UserTable.tsx`: the user list.
- `src/SignupForm.tsx`: the sign-up form.
