// SPDX-License-Identifier: Apache-2.0
/**
 * The text the markdown reports are made of, in one place so every report prints a gap, an interval, a reading and
 * the controls table the same way: one line of free text that cannot break a table or load anything, a signed gap, an
 * interval, a reading with its task count, and the controls line and table.
 */
'use strict';

/** The verdict of a control that has no usable judgments. */
const NOT_RUN = 'NOT RUN';

/**
 * Text read from a record or a name, on one line, with no character that could break a list or a table, and no link,
 * image or HTML tag: `<` becomes the entity `&lt;` (a backslash escape would fail on a text that already holds a
 * backslash before `<`) and the `](` of a link is escaped, so a viewer shows the text and loads nothing.
 */
const oneLine = (text) =>
  String(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[|`]/g, "'")
    .replace(/</g, '&lt;')
    .replace(/\]\(/g, ']\\(')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A gap or interval end to 2 decimals with its sign, or to 2 significant digits when it is not 0 but would print as 0
 * (+0.00 or -0.00): a label read from such an end then shows the figure that decided it. `n/a` for no number.
 */
const formatGap = (value) => {
  if (typeof value !== 'number') return 'n/a';
  const shown =
    value !== 0 && Number(value.toFixed(2)) === 0
      ? value.toPrecision(2)
      : value.toFixed(2);
  return `${value >= 0 ? '+' : ''}${shown}`;
};

/** `[low, high]` with each end printed by `format` (default formatGap), or `n/a` when there is no interval. */
const formatInterval = (interval, format = formatGap) =>
  Array.isArray(interval)
    ? `[${format(interval[0])}, ${format(interval[1])}]`
    : 'n/a';

/** A reading ({ mean_gap, t_interval, tasks_counted }) as `gap [interval] (n=tasks)`, or `n/a` with no mean. */
const formatReading = (reading) =>
  reading && typeof reading.mean_gap === 'number'
    ? `${formatGap(reading.mean_gap)} ${formatInterval(reading.t_interval)} (n=${reading.tasks_counted})`
    : 'n/a';

/** What each controls status says about the readings, after `Controls: **<status>**`. */
const CONTROLS_LINE = Object.freeze({
  PASS: 'every control the run includes passes',
  FAIL: 'a control failed or was not run, so the readings are not trusted',
  NONE: 'the run includes no control, so the readings are not trusted',
});

/**
 * The lines of the controls table for `controls`, a list of [name, evaluation]: the name, the verdict and the checks. A
 * control that is not run has no verdict to explain, so only what is missing is shown, as its checks read readings
 * that are not there. No control gives one line that says so.
 */
function controlsTable(controls) {
  if (!controls.length) return ['No control is in this run.'];
  const lines = ['| Control | Verdict | Checks |', '| --- | --- | --- |'];
  for (const [name, evaluation] of controls) {
    const checks =
      evaluation.status === NOT_RUN
        ? []
        : evaluation.checks.map(
            (entry) =>
              `${entry.ok ? 'ok' : 'NO'}: ${oneLine(entry.name)} (${oneLine(entry.detail)})`,
          );
    const missing = evaluation.missing.length
      ? [`missing: ${evaluation.missing.map(oneLine).join('; ')}`]
      : [];
    lines.push(
      `| \`${oneLine(name)}\` | **${evaluation.status}** | ${[...checks, ...missing].join('<br>')} |`,
    );
  }
  return lines;
}

module.exports = {
  NOT_RUN,
  CONTROLS_LINE,
  oneLine,
  formatGap,
  formatInterval,
  formatReading,
  controlsTable,
};
