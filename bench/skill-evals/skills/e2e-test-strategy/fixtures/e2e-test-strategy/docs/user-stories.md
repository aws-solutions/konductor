# User Stories: TaskFlow

- US-1.1 (P0) As a task manager I can create a task with a title, due date and assignee.
  - AC-1.1.1 Task appears in my list after save. AC-1.1.2 Assignee gets an in-app notification.
- US-1.2 (P2) As a user I can view a task's detail page.
- US-2.1 (P1) As a user I can share a task with a teammate by email; they receive an invite email and can open the task.
  - AC-2.1.1 Invite email sent within 60 s. AC-2.1.2 Invitee without access sees 403 until they accept.
- US-2.2 (P2) As a user I can export my tasks to CSV.
- US-3.1 (P0) As a user I can log in with email and password (Cognito).
  - AC-3.1.1 Valid credentials land on dashboard. AC-3.1.2 5 failed attempts lock the account for 15 min.
- US-3.2 (P0) As a user I can reset my password via an emailed link.
  - AC-3.2.1 Link expires after 30 min. AC-3.2.2 A used link cannot be reused.
- US-4.1 (P3) As a user I can switch between light and dark theme.
