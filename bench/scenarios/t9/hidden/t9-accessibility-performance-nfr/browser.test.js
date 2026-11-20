'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('./bench-browser.js');

// What the page should show, worked out from the repository's own data and rules.
async function expectedCount(controls) {
  const { orders } = await import('./data/orders.js');
  const { filterOrders } = await import('./src/filter.js');
  return filterOrders(orders, controls).length;
}

async function withPage(fn) {
  const app = await open(__dirname);
  try {
    await app.page.goto(`${app.url}/index.html`);
    await app.page.getByRole('radio', { name: 'All' }).waitFor();
    await fn(app.page, app);
    assert.deepEqual(app.errors, [], 'the page must not throw');
  } finally {
    await app.close();
  }
}

// The text of the polite live region that carries "N orders shown" ('' when there is none).
const liveText = (page) => page.evaluate(() => {
  const nodes = document.querySelectorAll('[aria-live="polite"], [role="status"]');
  for (const n of nodes) {
    const t = n.textContent.trim();
    if (/^\d+ orders shown$/.test(t)) return t;
  }
  return '';
});

// Chooses a status the way a keyboard user does (visually hidden inputs cannot always be clicked).
async function pick(page, name) {
  const radio = page.getByRole('radio', { name });
  await radio.focus();
  await page.keyboard.press('Space');
  assert.equal(await radio.isChecked(), true, `${name} is selected`);
}

// Table rows on screen, without the header row.
const rowCount = async (page) => (await page.getByRole('row').count()) - 1;

// The element that describes an input: the target of aria-describedby or aria-errormessage.
async function messageFor(input) {
  return input.evaluate((el) => {
    const ids = `${el.getAttribute('aria-describedby') || ''} ${el.getAttribute('aria-errormessage') || ''}`.split(/\s+/).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id))
      .filter((n) => n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden')
      .map((n) => n.textContent.trim())
      .filter(Boolean)
      .join(' | ');
  });
}

const invalid = (input) => input.evaluate((el) => el.getAttribute('aria-invalid'));

test('status filter is a radio group: Tab reaches it, arrow keys move the selection and filter the list', async () => {
  await withPage(async (page) => {
    const radios = ['All', 'Processing', 'Shipped', 'Delivered'].map((name) => page.getByRole('radio', { name }));
    assert.equal(await radios[0].isChecked(), true, 'All starts selected');

    await page.getByLabel('Search orders').focus();
    await page.keyboard.press('Tab');
    assert.equal(await radios[0].evaluate((el) => el === document.activeElement), true, 'Tab from the search box lands on the selected radio');

    await page.keyboard.press('ArrowRight');
    assert.equal(await radios[1].isChecked(), true);
    assert.equal(await radios[0].isChecked(), false);
    assert.equal(await liveText(page), `${await expectedCount({ status: 'processing' })} orders shown`);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await radios[3].isChecked(), true, 'two more presses reach Delivered');
    assert.equal(await liveText(page), `${await expectedCount({ status: 'delivered' })} orders shown`);

    await page.keyboard.press('ArrowLeft');
    assert.equal(await radios[2].isChecked(), true);
    assert.equal(await liveText(page), `${await expectedCount({ status: 'shipped' })} orders shown`);
  });
});

test('the live region reports the full match count, not the rows on screen', async () => {
  await withPage(async (page) => {
    const total = await expectedCount({});
    assert.ok(total > 1000);
    assert.equal(await liveText(page), `${total} orders shown`);
    assert.equal(await rowCount(page), 50);

    // The region is polite and is the same node before and after a change.
    const region = await page.evaluate(() => {
      const n = [...document.querySelectorAll('[aria-live], [role="status"]')].find((x) => /orders shown/.test(x.textContent));
      return n ? { live: n.getAttribute('aria-live'), role: n.getAttribute('role') } : null;
    });
    assert.ok(region, 'a live region exists');
    assert.ok(region.live === 'polite' || (region.role === 'status' && region.live !== 'assertive'), 'the region is polite');

    await pick(page, 'Shipped');
    assert.equal(await liveText(page), `${await expectedCount({ status: 'shipped' })} orders shown`);

    // A date range and a status together.
    await page.getByLabel('From', { exact: true }).fill('14/03/2025');
    await page.getByLabel('To', { exact: true }).fill('2025-04-20');
    await page.getByLabel('To', { exact: true }).press('Enter');
    const want = await expectedCount({ status: 'shipped', from: '14/03/2025', to: '2025-04-20' });
    assert.ok(want > 0 && want < 50, 'the range is small enough to fit on one page');
    assert.equal(await liveText(page), `${want} orders shown`);
    assert.equal(await rowCount(page), want);
  });
});

test('To before From: a message tied to the To field, the field marked invalid, cleared once fixed', async () => {
  await withPage(async (page) => {
    const from = page.getByLabel('From', { exact: true });
    const to = page.getByLabel('To', { exact: true });
    await from.fill('2025-03-10');
    await to.fill('2025-03-01');
    await to.press('Enter');

    assert.equal(await invalid(to), 'true');
    const msg = await messageFor(to);
    assert.ok(msg.length >= 12, `a readable message is tied to To (got "${msg}")`);
    assert.notEqual(await invalid(from), 'true', 'From is fine, only To is marked');
    assert.equal(await messageFor(from), '');

    // Fix it by moving From, not To.
    await from.fill('2025-02-20');
    await from.press('Enter');
    assert.notEqual(await invalid(to), 'true');
    assert.equal(await messageFor(to), '');

    // Same day is a valid range.
    await from.fill('2025-03-10');
    await to.fill('10/03/2025');
    await to.press('Enter');
    assert.notEqual(await invalid(to), 'true');
    assert.equal(await liveText(page), `${await expectedCount({ from: '2025-03-10', to: '10/03/2025' })} orders shown`);
  });
});

test('a date that does not exist is reported on its own field, with a different message from a backwards range', async () => {
  await withPage(async (page) => {
    const from = page.getByLabel('From', { exact: true });
    const to = page.getByLabel('To', { exact: true });

    await from.fill('2025-02-30');
    await page.getByRole('button', { name: 'Apply' }).click();
    assert.equal(await invalid(from), 'true');
    const missing = await messageFor(from);
    assert.ok(missing.length >= 12);
    assert.notEqual(await invalid(to), 'true');

    await from.fill('2025-03-10');
    await to.fill('31/04/2025');
    await to.press('Enter');
    assert.notEqual(await invalid(from), 'true', 'a fixed From loses its message');
    assert.equal(await messageFor(from), '');
    assert.equal(await invalid(to), 'true');
    assert.ok((await messageFor(to)).length >= 12);

    await to.fill('2025-03-01');
    await to.press('Enter');
    assert.notEqual(await messageFor(to), '');
    assert.notEqual(await messageFor(to), missing, 'a backwards range says something else than a missing day');

    // Day-first dates the page already accepts stay valid.
    await from.fill('14.03.2025');
    await to.fill('2025-03-20');
    await to.press('Enter');
    assert.notEqual(await invalid(from), 'true');
    assert.notEqual(await invalid(to), 'true');
    assert.equal(await liveText(page), `${await expectedCount({ from: '14.03.2025', to: '2025-03-20' })} orders shown`);
  });
});

test('only 50 rows render until Show more is pressed, and a filter change starts again at 50', async () => {
  await withPage(async (page) => {
    const more = page.getByRole('button', { name: 'Show more' });
    const total = await expectedCount({});
    assert.equal(await rowCount(page), 50);
    assert.equal(await liveText(page), `${total} orders shown`);

    await more.click();
    assert.equal(await rowCount(page), 100);
    assert.equal(await liveText(page), `${total} orders shown`, 'the count does not follow the rows');

    await pick(page, 'Processing');
    assert.equal(await rowCount(page), Math.min(50, await expectedCount({ status: 'processing' })));

    // Page through a smaller list to its end.
    await pick(page, 'Shipped');
    const shipped = await expectedCount({ status: 'shipped' });
    for (let i = 0; i < 40 && (await more.count()) > 0 && (await more.isVisible()) && (await more.isEnabled()); i += 1) {
      await more.click();
    }
    assert.equal(await rowCount(page), shipped, 'every shipped order shows up after paging to the end');
    const gone = (await more.count()) === 0 || !(await more.isVisible()) || !(await more.isEnabled());
    assert.ok(gone, 'no Show more once everything is on screen');
  });
});

test('typing waits for a pause: nothing changes inside 200 ms, one update after, and each key restarts the wait', async () => {
  const app = await open(__dirname);
  try {
    const { page } = app;
    await page.clock.install();
    await page.goto(`${app.url}/index.html`);
    await page.getByRole('radio', { name: 'All' }).waitFor();
    const total = await expectedCount({});
    const kettles = await expectedCount({ query: 'kettle' });
    assert.ok(kettles > 0 && kettles < total);

    const box = page.getByLabel('Search orders');
    await box.focus();
    await page.keyboard.type('ket');
    await page.clock.runFor(150);
    assert.equal(await liveText(page), `${total} orders shown`, 'still waiting 150 ms after the last key');
    await page.keyboard.type('tle');
    await page.clock.runFor(150);
    assert.equal(await liveText(page), `${total} orders shown`, 'a later key restarts the wait');
    await page.clock.runFor(100);
    assert.equal(await liveText(page), `${kettles} orders shown`, 'the list updates once the pause is over');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Enter filters at once, and a pending search still honours a status picked meanwhile', async () => {
  const app = await open(__dirname);
  try {
    const { page } = app;
    await page.clock.install();
    await page.goto(`${app.url}/index.html`);
    await page.getByRole('radio', { name: 'All' }).waitFor();
    const box = page.getByLabel('Search orders');

    // Accent-free typing finds accented names, and Enter does not wait.
    await box.focus();
    await page.keyboard.type('soren');
    await page.keyboard.press('Enter');
    const soren = await expectedCount({ query: 'soren' });
    assert.ok(soren > 0);
    assert.equal(await liveText(page), `${soren} orders shown`);
    const rows = await rowCount(page);
    assert.equal(rows, Math.min(50, soren));
    await page.clock.runFor(1000);
    assert.equal(await liveText(page), `${soren} orders shown`, 'nothing changes after the flush');

    // Type, then change the status before the pause is over.
    await box.fill('');
    await page.keyboard.press('Enter');
    await box.focus();
    await page.keyboard.type('enamel');
    await pick(page, 'Delivered');
    await page.clock.runFor(400);
    const both = await expectedCount({ query: 'enamel', status: 'delivered' });
    assert.ok(both > 0);
    assert.equal(await liveText(page), `${both} orders shown`, 'the result uses the query and the status chosen since');

    // A business name with & stays text in the table.
    await box.fill('fennimore & daughters');
    await page.keyboard.press('Enter');
    await pick(page, 'All');
    const fenn = await expectedCount({ query: 'fennimore & daughters' });
    assert.equal(await liveText(page), `${fenn} orders shown`);
    const text = await page.getByRole('row').nth(1).innerText();
    assert.match(text, /Fennimore & Daughters/);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
