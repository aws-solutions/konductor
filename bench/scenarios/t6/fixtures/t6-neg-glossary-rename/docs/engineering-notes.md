# Engineering notes from the editor refresh

The editor API accepts a stable container identifier. Keep the public code identifier `workspaceId` for compatibility with saved links and browser extensions. Display labels are not serialized into old note records.

The migration draft is intentionally incomplete. It still needs a decision on whether a renamed container should emit both the old and new analytics event names. Do not infer that decision from this note.

Observed issue: a pasted checklist can trigger two save events when the network changes from offline to online.
