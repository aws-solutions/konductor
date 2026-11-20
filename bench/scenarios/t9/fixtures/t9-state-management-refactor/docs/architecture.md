# Architecture notes

The application is split into stateful board operations and small adapters. `board.js` is the entry point used by the browser shell. `keyboard.js` translates key names into board operations, `drag.js` describes a card transfer, and `persist.js` turns the current board into a portable record.

The modules below `src/` do not access the DOM. A view can subscribe to board changes and ask for column or card view models after each change.
