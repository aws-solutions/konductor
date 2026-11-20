// Changes for this request; see the commit message for the reasoning.
'use strict';

const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const { readArchive } = require('./archive');

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function accountFolder(root, userId) {
  const id = String(userId ?? '');
  if (!id || id === '.' || id === '..' || CONTROL_CHARACTERS.test(id) || id.includes('/') || id.includes('\\')) {
    throw new Error('invalid account');
  }
  return path.resolve(String(root), id);
}

function asBuffer(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
}

function invalidPath() {
  return { status: 400, body: { error: 'invalid file path' } };
}

function relativePath(value, allowEmpty = false) {
  const raw = String(value ?? '');
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error('invalid path encoding');
  }
  if (CONTROL_CHARACTERS.test(decoded)) throw new Error('control character in path');
  const portable = decoded.replaceAll('\\', '/');
  if (!allowEmpty && portable.length === 0) throw new Error('empty path');
  if (portable.startsWith('/') || /^[A-Za-z]:\//.test(portable)) throw new Error('absolute path');
  const parts = portable.split('/');
  if (parts.some((part) => part === '..')) throw new Error('parent path');
  if (allowEmpty && (portable === '' || portable === '.')) return '';
  const normalized = path.posix.normalize(portable);
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) throw new Error('outside folder');
  return normalized;
}

function fileName(value) {
  const name = String(value ?? '');
  if (!name || name === '.' || name === '..' || CONTROL_CHARACTERS.test(name) || name.includes('/') || name.includes('\\')) {
    throw new Error('invalid file name');
  }
  return name;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function secureExistingPath(folder, relative) {
  const target = path.join(folder, ...relative.split('/'));
  const resolvedFolder = await fs.realpath(folder);
  const resolvedTarget = await fs.realpath(target);
  if (!isInside(resolvedFolder, resolvedTarget)) throw new Error('outside folder');
  return resolvedTarget;
}

async function secureParent(folder, relative) {
  const target = path.join(folder, ...relative.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const resolvedFolder = await fs.realpath(folder);
  const resolvedParent = await fs.realpath(path.dirname(target));
  if (!isInside(resolvedFolder, resolvedParent) && resolvedParent !== resolvedFolder) throw new Error('outside folder');
  return target;
}

async function uploadFile(storageRoot, userId, input = {}) {
  let folder;
  let name;
  try {
    folder = accountFolder(storageRoot, userId);
    name = fileName(input.name);
  } catch {
    return invalidPath();
  }
  const content = asBuffer(input.content);
  await fs.mkdir(folder, { recursive: true });
  const target = path.join(folder, name);
  const flags = input.overwrite === true
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
  try {
    const handle = await fs.open(target, flags, 0o600);
    try {
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
    return { status: 201, body: { name, bytes: content.length } };
  } catch (error) {
    if (error.code === 'EEXIST') return { status: 409, body: { error: 'file already exists' } };
    return invalidPath();
  }
}

async function downloadFile(storageRoot, userId, input = {}) {
  let folder;
  let relative;
  try {
    folder = accountFolder(storageRoot, userId);
    relative = relativePath(input.path);
    const target = await secureExistingPath(folder, relative);
    return { status: 200, body: await fs.readFile(target) };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 404, body: { error: 'file not found' } };
    return error.message === 'invalid account' ? invalidPath() : invalidPath();
  }
}

async function listFolder(storageRoot, userId, input = {}) {
  let folder;
  let relative;
  try {
    folder = accountFolder(storageRoot, userId);
    relative = relativePath(input.path, true);
    const target = relative ? await secureExistingPath(folder, relative) : await fs.realpath(folder);
    const entries = await fs.readdir(target, { withFileTypes: true });
    return {
      status: 200,
      body: { entries: entries.map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'folder' : 'file' })) }
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 404, body: { error: 'folder not found' } };
    return invalidPath();
  }
}

async function writeImportedFile(folder, entry) {
  const target = await secureParent(folder, entry.name);
  const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(entry.content);
  } finally {
    await handle.close();
  }
}

async function importArchive(storageRoot, userId, input = {}) {
  let folder;
  let entries;
  try {
    folder = accountFolder(storageRoot, userId);
    entries = readArchive(input.archive);
    entries = entries.map((entry) => ({ ...entry, name: relativePath(entry.name) }));
  } catch {
    return invalidPath();
  }
  await fs.mkdir(folder, { recursive: true });
  try {
    for (const entry of entries) await writeImportedFile(folder, entry);
  } catch {
    return invalidPath();
  }
  return { status: 201, body: { imported: entries.length } };
}

module.exports = { uploadFile, downloadFile, listFolder, importArchive };
