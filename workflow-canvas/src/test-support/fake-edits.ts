// SPDX-License-Identifier: Apache-2.0
import { vi, type Mock } from 'vitest';
import type { DiagnosticView, WorkflowView } from '../api/types';
import type { EditPort } from '../designer/core';
import { HELLO_DOCUMENT, HELLO_VIEW } from './fixtures';

/** The hash that the fake server gives a text that was saved. */
export const SAVED_HASH = 'b'.repeat(64);

/** An edit port whose calls are mocks, so a test can see and change them. */
export interface FakeEdits extends EditPort {
  save: Mock<EditPort['save']>;
  check: Mock<EditPort['check']>;
  reload: Mock<EditPort['reload']>;
}

/** A finding of the check, for the key path and the sentence. */
export function finding(path: string, message: string): DiagnosticView {
  return { message, path, line: 2, severity: 'error' };
}

/**
 * The view of a text in the layout of the sample: the stages are read from its
 * `- name:` and `agent:` lines. A real server parses the whole YAML; this is
 * only as much as a test of the page needs.
 */
export function viewOfText(text: string): WorkflowView {
  const stages = [
    ...text.matchAll(/- name: "?([^"\n]*)"?\n\s+agent: "?([^"\n]*)"?/g),
  ];
  return {
    ...HELLO_VIEW,
    stages: stages.map((match) => ({
      name: match[1] ?? '',
      agent: match[2] ?? '',
    })),
  };
}

/**
 * A server that accepts everything: a check finds nothing, a save writes and
 * answers with the view of the text it was sent, and a reload gives the
 * sample workflow. A test replaces the mock of the call it is about.
 */
export function acceptingEdits(): FakeEdits {
  return {
    save: vi.fn(async (text: string) => ({
      hash: SAVED_HASH,
      view: viewOfText(text),
      diagnostics: [],
    })),
    check: vi.fn(async (text: string) => ({
      view: viewOfText(text),
      diagnostics: [],
    })),
    reload: vi.fn(async () => HELLO_DOCUMENT),
  };
}
