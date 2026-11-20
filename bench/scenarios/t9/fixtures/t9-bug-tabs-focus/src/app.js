import './roving.js';
const { createRoving } = globalThis.NorthstarRoving;

const tablist = document.querySelector('[data-tab-list]');
const toolbar = document.querySelector('[data-tool-list]');
const tabRoving = createRoving(tablist, { itemSelector: '[role="tab"]' });
const toolRoving = createRoving(toolbar, { itemSelector: '[data-tool]' });

function showPanel(tab) {
  document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
    panel.hidden = panel.id !== tab.getAttribute('aria-controls');
  });
}

function closeTab(tab) {
  const panel = document.getElementById(tab.getAttribute('aria-controls'));
  if (panel) panel.remove();
  tab.remove();
  setTimeout(() => {
    const replacement = tablist.querySelector('[role="tab"][tabindex="0"]');
    if (replacement) {
      replacement.focus();
      showPanel(replacement);
    }
  }, 0);
}

tablist.addEventListener('click', (event) => {
  const close = event.target.closest('[data-close-tab]');
  if (close) {
    event.stopPropagation();
    closeTab(close.closest('[role="tab"]'));
    return;
  }
  const tab = event.target.closest('[role="tab"]');
  if (tab && !tab.matches('[aria-disabled="true"]')) showPanel(tab);
});

tablist.addEventListener('keydown', (event) => {
  const close = event.target.closest('[data-close-tab]');
  if (close && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    closeTab(close.closest('[role="tab"]'));
  }
});

document.querySelector('[data-disable-tab]').addEventListener('click', () => {
  const tab = tablist.querySelector('[role="tab"][tabindex="0"]');
  if (!tab) return;
  tab.setAttribute('aria-disabled', 'true');
  tab.dataset.disabled = 'true';
  const close = tab.querySelector('[data-close-tab]');
  if (close) close.disabled = true;
});

document.querySelector('[data-enable-tabs]').addEventListener('click', () => {
  tablist.querySelectorAll('[role="tab"]').forEach((tab) => {
    tab.removeAttribute('aria-disabled');
    delete tab.dataset.disabled;
    const close = tab.querySelector('[data-close-tab]');
    if (close) close.disabled = false;
  });
});

document.querySelector('[data-disable-tool]').addEventListener('click', () => {
  const tool = toolbar.querySelector('[data-tool][tabindex="0"]');
  if (tool) tool.disabled = true;
});

document.querySelector('[data-enable-tools]').addEventListener('click', () => {
  toolbar.querySelectorAll('[data-tool]').forEach((tool) => { tool.disabled = false; });
});

tablist.querySelectorAll('[role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (!tab.matches('[aria-disabled="true"]')) showPanel(tab);
  });
});

showPanel(tablist.querySelector('[role="tab"][tabindex="0"]'));
