// SPDX-License-Identifier: Apache-2.0
'use strict';

// Judge views: how a judge sees a run. judge/run.js and judge/packrun.js pick a view by id and use only this interface,
// so no other file branches on a view's name. A view is an object:
//   id           its id (view/ids.js)
//   needs        what the judge backend's descriptor must offer (`offers` in its judge-backend meta), e.g. 'readTools'
//   callerNeeds  what the live caller must offer (`caller.offers()`), e.g. 'isolation'
//   modes        the judging modes it serves: rubric, pairwise, graded, pack
//   prepare({ runDir, result, fixtureDir, limits, redactions }) -> input: { bundle, promptText, preface }
//                `bundle` is buildBundle's result, used for quote matching and the records; `promptText` is what the
//                prompt shows of the run; `preface` (optional) is put in the prompt above the task
//   call(caller, req, input) -> the caller's result for req ({ model, prompt })
//   audit(result, input) -> null, or why a reply must not be scored (the judgment becomes an error, a gap)
//   cacheParts(input) -> null (the cache key stays the one from before views), or strings added to the key
// The views are in-tree; a `judge-view` plugin kind can come later if views from outside the bench are needed (BACKLOG).

const { VIEW_IDS, RESERVED_VIEW_IDS, DEFAULT_VIEW, viewIdError } = require('./ids.js');

const VIEWS = Object.freeze({ bundle: require('./bundle.js'), read: require('./read.js') });

/** The view named `id`. Throws on an unknown or reserved id. */
function viewOf(id) {
  const why = viewIdError(id);
  if (why) throw new Error(why);
  return VIEWS[id];
}

/** The view id for a task: the --judge-view flag wins, then the task's judgeView, then bundle. Throws on a bad id. */
function chooseViewId({ flag = null, task = null }) {
  const id = flag ?? task?.judgeView ?? DEFAULT_VIEW;
  viewOf(id);
  return id;
}

const listOr = (xs) => (xs.length ? xs.join(', ') : 'nothing');

/** Throws unless the judge backend registry part `part` offers everything `view` needs. */
function checkViewBackend(view, part) {
  const offers = part?.meta?.offers ?? [];
  const missing = view.needs.filter((n) => !offers.includes(n));
  if (missing.length) throw new Error(`judge view "${view.id}" needs ${missing.join(', ')}, which the ${part?.name ?? 'unknown'} judge backend does not offer (it offers: ${listOr(offers)})`);
}

/** Throws unless the live `caller` offers everything `view` needs at run time (its `offers()`; `why()` says what is missing). */
function checkViewCaller(view, caller) {
  const offers = typeof caller?.offers === 'function' ? caller.offers() : [];
  const missing = view.callerNeeds.filter((n) => !offers.includes(n));
  if (missing.length) {
    const why = typeof caller?.why === 'function' ? caller.why(missing) : null;
    throw new Error(`judge view "${view.id}" needs ${missing.join(', ')}, which this judge caller does not have${why ? `: ${why}` : ''}`);
  }
}

/** Throws when `view` does not serve one of `modes`. */
function checkViewModes(view, modes) {
  const bad = modes.filter((m) => !view.modes.includes(m));
  if (bad.length) throw new Error(`judge view "${view.id}" serves ${view.modes.join(', ')} only, not ${bad.join(', ')}; pass --mode ${view.modes.join(',')} or --judge-view ${DEFAULT_VIEW}`);
}

/**
 * The caller of one view input: it calls through the view, then audits the result, so a reply that fails the audit is an
 * error and is never written to the answer cache.
 */
function viewCaller(view, caller, input) {
  const fn = async (req) => {
    const r = await view.call(caller, req, input);
    if (r.error) return r;
    const why = view.audit(r, input);
    return why ? { ...r, text: '', error: why } : r;
  };
  if (caller?.stopReason) fn.stopReason = caller.stopReason;
  return fn;
}

module.exports = { viewOf, chooseViewId, checkViewBackend, checkViewCaller, checkViewModes, viewCaller, VIEW_IDS, RESERVED_VIEW_IDS, DEFAULT_VIEW };
