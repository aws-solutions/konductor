# Answer key: backend-development fixture

Plain Node, no dependencies; `npm test` runs `node --test` (9 passing at baseline).
- p1: src/handlers/updateTaskStatus.js requires ../db and calls db.get/db.update directly, bypassing facade -> factory service -> repo. Fix routes through taskFacade.changeStatus and maps NotFoundError to 404.
- p2: TaskService.changeStatus does read-check-save; taskRepo.save is an unconditional put. Fix: conditional write `{ condition: { attr: 'status', equals: <read status> } }` and a specific conflict error.
- p3: taskRepo.create does db.put then db.get; db.put already returns the item.
md5 of files that must not change: src/db.js 13205eed85faa366d9804fe6fa01dd96, src/handlers/getTask.js a9fc976ec5054666976494b3f9b7d0e0,
src/errors.js 496af8ce0185a9dc20a1c281615e79d3, src/log.js 8f6e1526ec8102a4324178adc7146535.
