'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderDocumentExport(document) {
  return [
    '<!doctype html>',
    '<article>',
    `<h1>${escapeHtml(document.title)}</h1>`,
    `<p>${escapeHtml(document.body)}</p>`,
    '</article>',
  ].join('');
}

module.exports = { escapeHtml, renderDocumentExport };
