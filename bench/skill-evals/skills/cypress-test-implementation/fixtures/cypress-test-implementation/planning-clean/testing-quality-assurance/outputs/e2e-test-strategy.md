# E2E Test Strategy: TaskBoard web app

## Prioritization Matrix

| ID | Journey | Priority | Score | Effort |
|----|---------|----------|-------|--------|
| E2E-001 | User login and task creation | P0 | 9.5 | 4h |
| E2E-002 | Edit and complete a task | P0 | 9.0 | 3h |
| E2E-003 | Search and filter tasks | P1 | 7.0 | 3h |
| E2E-004 | Bulk delete tasks | P2 | 4.5 | 2h |

## User Journey Coverage

### E2E-001: User login and task creation
- Stories: US-1, US-2. Acceptance criteria: AC-1.1, AC-2.1
- Steps: visit /login, enter valid credentials, land on /board, click "New task", enter title, save, task appears in "To do" column.
- Assertions: board heading visible; new task card shows exact title.
- Test data: one valid user, one task title.
- Cleanup: delete created task via API.

### E2E-002: Edit and complete a task
- Stories: US-3. Acceptance criteria: AC-3.1, AC-3.2
- Steps: log in, open existing task, change title, mark complete, task moves to "Done".
- Assertions: updated title shown; card is in Done column.

### E2E-003: Search and filter tasks
- Stories: US-4. Acceptance criteria: AC-4.1
- Steps: log in, type in search box, filter by "Done" status, only matching cards shown.

### E2E-004: Bulk delete tasks
- Stories: US-5. Acceptance criteria: AC-5.1
- Steps: log in, select 3 tasks, click "Delete selected", confirm dialog, cards removed.
