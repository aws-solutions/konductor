// SPDX-License-Identifier: Apache-2.0
'use strict';

// The judge view ids, with no other code so the task loader can check a task's judgeView without loading the views.
// Built views are in VIEW_IDS. RESERVED_VIEW_IDS are names kept for designs not built yet (one prompt sized to the
// window, a conversation, rolling notes); a task or flag naming one is refused.
const VIEW_IDS = Object.freeze(['bundle', 'read']);
const RESERVED_VIEW_IDS = Object.freeze(['full', 'conversation', 'notes']);
const DEFAULT_VIEW = 'bundle';

/** Why `id` is not a usable judge view, or null when it is one. */
function viewIdError(id) {
  if (VIEW_IDS.includes(id)) return null;
  if (RESERVED_VIEW_IDS.includes(id)) return `judge view "${id}" is not built yet (built: ${VIEW_IDS.join(', ')})`;
  return `unknown judge view "${id}": the judge views are ${VIEW_IDS.join(', ')}`;
}

module.exports = { VIEW_IDS, RESERVED_VIEW_IDS, DEFAULT_VIEW, viewIdError };
