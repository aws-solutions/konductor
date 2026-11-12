// SPDX-License-Identifier: Apache-2.0
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/** One view of the page: a segment of the switch and the panel it shows. */
export interface PageView<Id extends string> {
  id: Id;
  label: string;
  content: ReactNode;
}

const tabId = (id: string) => `wf-view-${id}-tab`;
const panelId = (id: string) => `wf-view-${id}-panel`;

/**
 * The switch between the views of the page, drawn as a segmented control in
 * the page header. It is a tab list: Tab reaches the selected segment, and the
 * arrow keys, Home and End move to another segment and select it.
 */
export function ModeSwitch<Id extends string>({
  views,
  active,
  onChange,
  ariaLabel,
}: {
  views: readonly PageView<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  ariaLabel: string;
}) {
  const buttons = useRef(new Map<Id, HTMLButtonElement>());

  const select = (id: Id) => {
    onChange(id);
    buttons.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = views.findIndex((view) => view.id === active);
    const target = {
      ArrowLeft: index - 1,
      ArrowRight: index + 1,
      Home: 0,
      End: views.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = views[(target + views.length) % views.length];
    if (next) select(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="wf-mode-switch"
      onKeyDown={onKeyDown}
    >
      {views.map((view) => {
        const selected = view.id === active;
        return (
          <button
            key={view.id}
            ref={(element) => {
              if (element) buttons.current.set(view.id, element);
              else buttons.current.delete(view.id);
            }}
            type="button"
            role="tab"
            id={tabId(view.id)}
            aria-selected={selected}
            aria-controls={panelId(view.id)}
            tabIndex={selected ? 0 : -1}
            className="wf-mode-segment"
            onClick={() => onChange(view.id)}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The panels of the views. Only the selected one has content, so a view that
 * is not shown keeps no state of its own.
 */
export function ModePanels<Id extends string>({
  views,
  active,
}: {
  views: readonly PageView<Id>[];
  active: Id;
}) {
  return (
    <>
      {views.map((view) => {
        const selected = view.id === active;
        return (
          <div
            key={view.id}
            role="tabpanel"
            id={panelId(view.id)}
            aria-labelledby={tabId(view.id)}
            tabIndex={0}
            hidden={!selected}
            className="wf-mode-panel"
          >
            {selected && view.content}
          </div>
        );
      })}
    </>
  );
}
