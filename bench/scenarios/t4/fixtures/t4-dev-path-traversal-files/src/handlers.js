'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readArchive } = require('./archive');

function accountFolder(root, userId) {
  return path.resolve(root, String(userId));
}

function asBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
}

async function uploadFile(storageRoot, userId, input = {}) {
  const folder = accountFolder(storageRoot, userId);
  await fs.mkdir(folder, { recursive: true });
  const name = String(input.name ?? '');
  const target = path.resolve(folder, name);
  await fs.writeFile(target, asBuffer(input.content));
  return { status: 201, body: { name, bytes: asBuffer(input.content).length } };
}

async function downloadFile(storageRoot, userId, input = {}) {
  const folder = accountFolder(storageRoot, userId);
  const requested = decodeURIComponent(String(input.path ?? ''));
  const target = path.resolve(folder, requested.replaceAll('\\', path.sep));
  try {
    const body = await fs.readFile(target);
    return { status: 200, body };
  } catch {
    return { status: 404, body: { error: `file not found: ${target}` } };
  }
}

async function listFolder(storageRoot, userId, input = {}) {
  const folder = accountFolder(storageRoot, userId);
  const requested = decodeURIComponent(String(input.path ?? ''));
  const target = path.resolve(folder, requested.replaceAll('\\', path.sep));
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    return {
      status: 200,
      body: { entries: entries.map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'folder' : 'file' })) }
    };
  } catch {
    return { status: 404, body: { error: `folder not found: ${target}` } };
  }
}

async function importArchive(storageRoot, userId, input = {}) {
  const folder = accountFolder(storageRoot, userId);
  const entries = readArchive(input.archive);
  await fs.mkdir(folder, { recursive: true });
  for (const entry of entries) {
    const target = path.resolve(folder, entry.name.replaceAll('\\', path.sep));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.content);
  }
  return { status: 201, body: { imported: entries.length } };
}

module.exports = { uploadFile, downloadFile, listFolder, importArchive };
