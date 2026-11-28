// SPDX-License-Identifier: Apache-2.0
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HELLO_DOCUMENT, loaded } from '../test-support/fixtures';
import { ApiError } from '../api/api';
import { COPY_UNCERTAIN_CODE, type NextPorts } from '../next-ui/next-http';
import { fakeNextPorts } from '../test-support/next-ports';
import { LibraryView } from './LibraryView';

const READY = {
  name: 'library/k-adversarial-pull-request-review',
  title: 'Adversarial pull request review',
  summary: 'Review a pull request.',
  status: 'ready' as const,
};
const PLANNED = {
  name: 'library/k-design-doc-creation',
  title: 'Design document creation',
  summary: 'Create a design document.',
  status: 'planned' as const,
  waits: 'The workflow needs human gates.',
};
const LIBRARY_DOCUMENT = {
  ...HELLO_DOCUMENT,
  name: READY.name,
  readOnly: true,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function subject(
  over = {},
  options: { copyDisabledReason?: string; beforeCopy?: () => boolean } = {},
) {
  const ports = fakeNextPorts({
    listLibrary: vi.fn(() => Promise.resolve([READY, PLANNED])),
    getLibrary: vi.fn(() => Promise.resolve(LIBRARY_DOCUMENT)),
    copyLibrary: vi.fn(() =>
      Promise.resolve({
        ...HELLO_DOCUMENT,
        name: 'adversarial-review',
        view: HELLO_DOCUMENT.view && {
          ...HELLO_DOCUMENT.view,
          name: 'adversarial-review',
        },
      }),
    ),
    ...over,
  });
  const onCopy = vi.fn();
  const onCopyUncertain = vi.fn();
  const onAnnounce = vi.fn();
  const load = loaded(HELLO_DOCUMENT);
  if (!load.ok) throw new Error('The fixture did not load.');
  const rendered = render(
    <LibraryView
      ports={ports}
      workflow={load.workflow}
      agents={[{ id: 'k-developer', summary: 'Code' }]}
      onCopy={onCopy}
      onCopyUncertain={onCopyUncertain}
      onAnnounce={onAnnounce}
      {...options}
    />,
  );
  return {
    ports,
    workflow: load.workflow,
    onCopy,
    onCopyUncertain,
    onAnnounce,
    ...rendered,
  };
}

function switchPorts(
  view: ReturnType<typeof subject>,
  ports: NextPorts,
  options: { copyDisabledReason?: string; beforeCopy?: () => boolean } = {},
) {
  view.rerender(
    <LibraryView
      ports={ports}
      workflow={view.workflow}
      agents={[{ id: 'k-developer', summary: 'Code' }]}
      onCopy={view.onCopy}
      onCopyUncertain={view.onCopyUncertain}
      onAnnounce={view.onAnnounce}
      {...options}
    />,
  );
}

describe('LibraryView', () => {
  it('lists ready and planned workflows with the planned reason', async () => {
    subject();

    expect(await screen.findByText(READY.title)).toBeTruthy();
    expect(screen.getByText(PLANNED.title)).toBeTruthy();
    expect(screen.getAllByText(PLANNED.waits).length).toBeGreaterThan(0);
    expect(
      (
        screen.getByRole('button', {
          name: `Open ${READY.title}`,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      screen
        .getByRole('button', { name: `Open ${PLANNED.title}` })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: `Start from ${PLANNED.title}` })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      (
        screen.getByRole('button', {
          name: `Start from ${PLANNED.title}`,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it('keeps Start from focusable but unavailable during an active run', async () => {
    const reason = 'A run is already active in this workspace.';
    subject({}, { copyDisabledReason: reason });
    await screen.findByText(READY.title);

    const listStart = screen.getByRole('button', {
      name: `Start from ${READY.title}`,
    });
    expect(listStart.getAttribute('aria-disabled')).toBe('true');
    expect((listStart as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(
      screen.getByRole('button', { name: `Open ${READY.title}` }),
    );
    const previewStart = screen.getByRole('button', {
      name: 'Start from',
    });
    expect(previewStart.getAttribute('aria-disabled')).toBe('true');
    expect((previewStart as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks a copy when a run starts after its dialog opens', async () => {
    const reason = 'A run is already active in this workspace.';
    const view = subject();
    await screen.findByText(READY.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Start from ${READY.title}` }),
    );

    switchPorts(view, view.ports, { copyDisabledReason: reason });
    const create = screen.getByRole('button', { name: 'Create copy' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(create);
    expect(view.ports.copyLibrary).not.toHaveBeenCalled();
  });

  it('clears a successful list when ports change', async () => {
    const view = subject();
    await screen.findByText(READY.title);
    const next = fakeNextPorts({
      listLibrary: vi.fn(() => Promise.resolve([PLANNED])),
    });

    switchPorts(view, next);

    expect(screen.queryByText(READY.title)).toBeNull();
    expect(screen.getByText('Loading Library')).toBeTruthy();
    expect(await screen.findByText(PLANNED.title)).toBeTruthy();
  });

  it('clears a list failure when ports change', async () => {
    const view = subject({
      listLibrary: vi.fn(() => Promise.reject(new Error('Library failed.'))),
    });
    await screen.findByText('Library failed.');
    const next = fakeNextPorts({
      listLibrary: vi.fn(() => Promise.resolve([READY])),
    });

    switchPorts(view, next);

    expect(screen.queryByText('Library failed.')).toBeNull();
    expect(screen.getByText('Loading Library')).toBeTruthy();
    expect(await screen.findByText(READY.title)).toBeTruthy();
  });

  it('shows an explicit empty state', async () => {
    subject({ listLibrary: vi.fn(() => Promise.resolve([])) });

    expect(
      await screen.findByText('No shipped workflows are available.'),
    ).toBeTruthy();
  });

  it('opens a ready entry read-only with its drawing and YAML', async () => {
    const { onAnnounce } = subject();
    await screen.findByText(READY.title);

    const open = screen.getByRole('button', { name: `Open ${READY.title}` });
    open.focus();
    fireEvent.click(open);

    expect(await screen.findByTestId('read-only-note')).toBeTruthy();
    expect(screen.getByTestId('node-stage-draft')).toBeTruthy();
    expect(screen.getByTestId('yaml-text').hasAttribute('readonly')).toBe(true);
    expect(screen.queryByTestId('library-live')).toBeNull();
    expect(onAnnounce).toHaveBeenCalledWith(`${READY.title} opened read-only.`);
    for (const name of ['Save', /^Add agent-/, 'Undo', 'Redo']) {
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled ||
          screen.getByRole('button', { name }).getAttribute('aria-disabled') ===
            'true',
      ).toBe(true);
    }
    const back = screen.getByRole('button', { name: 'Back to Library' });
    expect(document.activeElement).toBe(back);
    fireEvent.click(screen.getByRole('tab', { name: 'Properties' }));
    const properties = screen.getByRole('tabpanel', { name: 'Properties' });
    expect(
      within(properties)
        .getByLabelText('name', { exact: true })
        .hasAttribute('readonly'),
    ).toBe(true);
    expect(
      (
        within(properties).getByLabelText('agent', {
          exact: true,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      within(properties)
        .getByRole('button', { name: 'Delete stage' })
        .getAttribute('aria-disabled'),
    ).toBe('true');

    fireEvent.click(back);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: `Open ${READY.title}` }),
    );
  });

  it('validates the copy name, copies, and opens the editable result', async () => {
    const { ports, onCopy } = subject();
    await screen.findByText(READY.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Start from ${READY.title}` }),
    );
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Workflow name');

    fireEvent.change(input, { target: { value: 'Bad Name' } });
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Create copy',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.change(input, { target: { value: 'adversarial-review' } });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Create copy' }),
    );

    expect(ports.copyLibrary).toHaveBeenCalledWith(
      READY.name,
      'adversarial-review',
    );
    await waitFor(() =>
      expect(onCopy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'adversarial-review',
          readOnly: false,
        }),
      ),
    );
  });

  it('blocks through the parent when copy outcome is uncertain', async () => {
    const uncertain = new ApiError(
      'Reload the page before editing or running anything.',
      200,
      COPY_UNCERTAIN_CODE,
    );
    const { onCopyUncertain } = subject({
      copyLibrary: vi.fn(() => Promise.reject(uncertain)),
    });
    await screen.findByText(READY.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Start from ${READY.title}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    await waitFor(() =>
      expect(onCopyUncertain).toHaveBeenCalledWith(uncertain.message),
    );
  });

  it('submits a copy only once while the first request is pending', async () => {
    const pending = deferred<typeof HELLO_DOCUMENT>();
    const copyLibrary = vi.fn(() => pending.promise);
    const { onCopy } = subject({ copyLibrary });
    await screen.findByText(READY.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Start from ${READY.title}` }),
    );
    const create = screen.getByRole('button', { name: 'Create copy' });

    fireEvent.click(create);
    fireEvent.click(create);

    expect(copyLibrary).toHaveBeenCalledTimes(1);
    pending.resolve(HELLO_DOCUMENT);
    await waitFor(() => expect(onCopy).toHaveBeenCalledTimes(1));
  });

  it('aborts a detail request when the view unmounts', async () => {
    const pending = deferred<typeof LIBRARY_DOCUMENT>();
    let signal: AbortSignal | undefined;
    const { unmount } = subject({
      getLibrary: vi.fn((_name, requestSignal) => {
        signal = requestSignal;
        return pending.promise;
      }),
    });
    await screen.findByText(READY.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Open ${READY.title}` }),
    );

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('aborts the prior detail request when Open is repeated', async () => {
    const signals: AbortSignal[] = [];
    subject({
      getLibrary: vi.fn((_name, signal) => {
        signals.push(signal);
        return new Promise<typeof LIBRARY_DOCUMENT>(() => undefined);
      }),
    });
    await screen.findByText(READY.title);
    const open = screen.getByRole('button', { name: `Open ${READY.title}` });

    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }));
    fireEvent.click(
      screen.getByRole('button', { name: `Open ${READY.title}` }),
    );

    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('shows the server refusal when a run starts before copying', async () => {
    const refusal = 'A run is already active in this workspace.';
    subject({
      copyLibrary: vi.fn(() =>
        Promise.reject(
          new ApiError(refusal, 409, 'already_running', '20261024-0412-a7b3c'),
        ),
      ),
    });
    await screen.findByText(READY.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Start from ${READY.title}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(await screen.findByText(refusal)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps a name clash in the dialog', async () => {
    subject({
      copyLibrary: vi.fn(() =>
        Promise.reject(new Error('A workflow with this name already exists.')),
      ),
    });
    await screen.findByText(READY.title);
    fireEvent.click(
      screen.getByRole('button', { name: `Start from ${READY.title}` }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));

    expect(
      await screen.findByText('A workflow with this name already exists.'),
    ).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
