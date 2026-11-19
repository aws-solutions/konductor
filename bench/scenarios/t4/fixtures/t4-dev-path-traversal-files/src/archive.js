'use strict';

const HEADER = Buffer.from('T4AR1\n', 'ascii');

function encodeArchive(entries) {
  const parts = [HEADER];
  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8');
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(String(entry.content), 'utf8');
    const nameLength = Buffer.alloc(4);
    const contentLength = Buffer.alloc(8);
    nameLength.writeUInt32BE(name.length, 0);
    contentLength.writeBigUInt64BE(BigInt(content.length), 0);
    parts.push(nameLength, contentLength, name, content);
  }
  return Buffer.concat(parts);
}

function readArchive(input) {
  const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (data.length < HEADER.length || !data.subarray(0, HEADER.length).equals(HEADER)) {
    throw new Error('invalid archive');
  }
  const entries = [];
  let offset = HEADER.length;
  while (offset < data.length) {
    if (data.length - offset < 12) throw new Error('invalid archive record');
    const nameLength = data.readUInt32BE(offset);
    const contentLength = Number(data.readBigUInt64BE(offset + 4));
    offset += 12;
    if (!Number.isSafeInteger(contentLength) || offset + nameLength + contentLength > data.length) {
      throw new Error('invalid archive record');
    }
    const name = data.subarray(offset, offset + nameLength).toString('utf8');
    offset += nameLength;
    const content = Buffer.from(data.subarray(offset, offset + contentLength));
    offset += contentLength;
    entries.push({ name, content });
  }
  return entries;
}

module.exports = { encodeArchive, readArchive };
