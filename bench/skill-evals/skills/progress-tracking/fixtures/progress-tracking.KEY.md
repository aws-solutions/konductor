# progress-tracking fixture key (judge only)

Planted:
- Circular dependency: feature-implementation/tasks.md has Exports (2) depends on 3 and Search (3) depends on 2.
- alerts: all tasks [x]; requirement 2.3 (duplicate suppression) has no task -> uncovered.
- alerts final mode: design names src/alerts/notifier.py and task 3 ("Implement Notifier") is [x], but notifier.py does not exist -> implementation gap. service.py exists.
- exports: requirements.md, design.md, tasks.md all present, all tasks [ ] -> Specs Complete | Implementation Not Started (must not be called complete). src/exports/ does not exist.
- search: design.md missing; task 4 uses invalid checkbox `- [X]`; task 4 references requirement 1.3 which does not exist (invalid ref). Task 3 is [-] in progress.
- Progress counts: alerts 4/4 = 100%, exports 0/3 = 0%, search 2/4 = 50% (task 4 invalid; if read as done, 3/4 = 75%).
