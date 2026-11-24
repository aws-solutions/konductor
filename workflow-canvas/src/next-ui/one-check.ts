// SPDX-License-Identifier: Apache-2.0
import { ApiError } from '../api/api';
import type {
  CheckResult,
  LineRange,
  StageView,
  WorkflowView,
} from '../api/types';
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

// The adapter has already checked each stage's `kind` and `range`, so they
// are read as the contract types here.
function stageViewsOf(view: CheckView): StageView[] {
  return view.stages.map((stage) => ({
    name: stage.name,
    kind: textOf(stage.kind),
    agent: textOf(stage.agent),
    range: stage.range as LineRange,
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

// What a reader whose signal aborted is given, as the request behind it would
// have given: `ValidatePort` says the check fails when its signal does, and a
// caller that called it off drops the failure anyway.
function calledOff(): Error {
  return new DOMException('The check was called off.', 'AbortError');
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
 * So the call is made once for a text and handed to whoever asks for it: at
 * most one call per text, and an ask for a text already in flight joins it.
 * A call is never cut short because another text was asked about, because the
 * two readers ask at different moments and the one still waiting would read
 * the abort as a server that did not answer. It ends only when the last
 * reader waiting for it gives up. `name` is the workflow the text is for,
 * sent with every check, so the two readers ask the very same question.
 */
export function oneCheck(validate: ValidatePort, name?: string): OneCheck {
  interface Call {
    readonly text: string;
    readonly answer: Promise<CheckAnswer>;
    readonly abort: AbortController;
    /** How many readers are still waiting for this answer. */
    waiting: number;
    /** True once the answer has come, well or badly. */
    done: boolean;
  }
  // The calls still in flight, by their text, so a second reader of a text
  // joins the call rather than making another.
  const inFlight = new Map<string, Call>();
  // The newest call that has answered, kept so a reader that asks just after
  // it settled reads that answer instead of asking the same question again.
  let last:
    | { readonly text: string; readonly answer: Promise<CheckAnswer> }
    | undefined;

  const forget = (call: Call) => {
    if (inFlight.get(call.text) === call) inFlight.delete(call.text);
  };

  // One reader of a call. The call lives while a reader still waits for it,
  // so a reader that gives up never takes the answer of another away, and it
  // ends with the last of them.
  const readerOf = (call: Call) => {
    let gone = false;
    const off = (): boolean => {
      if (gone) return false;
      gone = true;
      call.waiting -= 1;
      return true;
    };
    return {
      /** This reader has given up: the call ends if it was the last. */
      gaveUp: () => {
        if (!off()) return;
        if (call.waiting > 0 || call.done) return;
        forget(call);
        call.abort.abort();
      },
      /** The answer came, so this reader waits for nothing. */
      settled: off,
    };
  };

  const requestOf = (text: string) =>
    name === undefined ? { text } : { name, text };

  const ask = (text: string): { call: Call; answer: Promise<CheckAnswer> } => {
    const live = inFlight.get(text);
    if (live) {
      live.waiting += 1;
      return { call: live, answer: live.answer };
    }
    const abort = new AbortController();
    const settled = last?.text === text ? last.answer : undefined;
    const answer = settled ?? validate(requestOf(text), abort.signal);
    const call: Call = { text, answer, abort, waiting: 1, done: false };
    if (settled) {
      call.done = true;
      return { call, answer };
    }
    inFlight.set(text, call);
    const ended = () => {
      call.done = true;
      forget(call);
    };
    // An answer that came, well or badly, is no longer in flight. A good one
    // is kept so the same text is not asked about twice; a failed one is not,
    // so the next ask for that text tries the server again rather than
    // reading the same failure.
    void answer.then(
      () => {
        ended();
        last = { text, answer };
      },
      () => {
        ended();
        if (last?.text === text) last = undefined;
      },
    );
    return { call, answer };
  };

  return {
    validate: (request, signal) => {
      // A reader that has already given up is not waiting for anything, so
      // its text is not asked about at all.
      if (signal.aborted) return Promise.reject(calledOff());
      const { call, answer } = ask(request.text);
      const reader = readerOf(call);
      // The reader waits on a promise of its own, not on the shared one, so
      // its signal ends its wait at once: the caller lines its checks up one
      // after another, and leaving a check it has called off at the head of
      // that line would hold the next one back. The call itself goes on for
      // whoever still waits for it, because the editor waits for the same
      // answer to say whether the draft may be saved, and losing it would
      // leave Save closed until the next edit.
      return new Promise<CheckAnswer>((resolve, reject) => {
        const giveUp = () => {
          reader.gaveUp();
          reject(calledOff());
        };
        signal.addEventListener('abort', giveUp, { once: true });
        const done = () => {
          reader.settled();
          signal.removeEventListener('abort', giveUp);
        };
        // Whichever comes first wins: a promise already settled takes no
        // second answer, so the reader that gave up keeps its failure.
        answer.then(
          (value) => {
            done();
            resolve(value);
          },
          (error) => {
            done();
            reject(error);
          },
        );
      });
    },
    check: async (text) => {
      const { call, answer } = ask(text);
      const reader = readerOf(call);
      try {
        return resultOf(await answer);
      } catch (error) {
        throw editorError(error);
      } finally {
        reader.settled();
      }
    },
  };
}
