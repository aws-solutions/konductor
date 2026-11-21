// SPDX-License-Identifier: Apache-2.0
import { ApiError } from '../api/api';
import type { CheckResult, StageView, WorkflowView } from '../api/types';
import type {
  CheckAnswer,
  CheckView,
  ValidatePort,
} from '../designer-view/yaml-draft';
import { SessionLost, type EditPort } from '../designer/core';

/** The status that says the server no longer knows the session. */
const SESSION_LOST_STATUS = 401;

/**
 * One check of a text, for the two readers of it: the view, which draws the
 * whole answer, and the editor, which judges the draft by its findings.
 */
export interface OneCheck {
  /** The check the view's draft makes, with every field of the answer. */
  readonly validate: ValidatePort;
  /** The check the editor makes, answered from the same call. */
  readonly check: EditPort['check'];
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stageViewsOf(view: CheckView): StageView[] {
  return view.stages.map((stage) => ({
    name: stage.name,
    agent: textOf(stage.agent),
  }));
}

// The answer as the editor reads it: the workflow it names and the findings.
// The editor keeps the findings; it has no use for the keys of a stage that
// only the view draws.
function resultOf(answer: CheckAnswer): CheckResult {
  const view: WorkflowView | null = answer.view
    ? {
        name: answer.view.name,
        intent: {
          outcome: textOf(
            (answer.view.intent as { outcome?: unknown } | null)?.outcome,
          ),
        },
        stages: stageViewsOf(answer.view),
      }
    : null;
  return {
    view,
    diagnostics: answer.diagnostics.map((finding) => ({
      message: finding.message,
      path: finding.path,
      line: finding.line,
      severity: finding.severity,
    })),
  };
}

// A lost session is its own failure for the editor, which says so at once
// because no save can work then.
function editorError(error: unknown): unknown {
  return error instanceof ApiError && error.status === SESSION_LOST_STATUS
    ? new SessionLost(error.message)
    : error;
}

/**
 * Makes one check of a text serve both readers of it.
 *
 * The page checks a text twice over: the editor checks each draft it has not
 * checked yet, to judge whether it may be saved, and the Design view checks
 * the same text for the keys and the lines of each stage. Both wait for the
 * same pause after the same edit, so without this they send two of the same
 * request and the text is parsed twice.
 *
 * So the call is made once for a text and handed to whoever asks for it. One
 * is in flight at a time: a text that is not the one in flight takes its
 * place, and the call it replaces is aborted, as the edit that asks for it
 * has made the answer of the one before it stale anyway. `name` is the
 * workflow the text is for, sent with every check, so the two readers ask the
 * very same question.
 */
export function oneCheck(validate: ValidatePort, name?: string): OneCheck {
  let held:
    | { text: string; answer: Promise<CheckAnswer>; abort: AbortController }
    | undefined;

  const ask = (text: string): Promise<CheckAnswer> => {
    if (held?.text === text) return held.answer;
    held?.abort.abort();
    const abort = new AbortController();
    const request = name === undefined ? { text } : { name, text };
    const answer = validate(request, abort.signal);
    const mine = { text, answer, abort };
    held = mine;
    // A call that failed is not held: the next ask for that text makes it
    // again rather than reading the failure twice.
    answer.catch(() => {
      if (held === mine) held = undefined;
    });
    return answer;
  };

  return {
    validate: (request, signal) => {
      const answer = ask(request.text);
      // The caller aborts when its text is no longer the one on the page,
      // which is when this call is stale for every reader of it.
      signal.addEventListener('abort', () => held?.abort.abort(), {
        once: true,
      });
      return answer;
    },
    check: async (text) => {
      try {
        return resultOf(await ask(text));
      } catch (error) {
        throw editorError(error);
      }
    },
  };
}
