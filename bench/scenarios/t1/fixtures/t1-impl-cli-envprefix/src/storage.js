'use strict';

async function listObjects({ bucket, prefix }) {
  return [
    { key: `${prefix}welcome.txt`, bucket, size: 12 },
    { key: `${prefix}readme.md`, bucket, size: 84 }
  ];
}

async function uploadFiles(records, options) {
  return records.map((record) => ({
    key: `${options.prefix}${record.relative}`,
    bucket: options.bucket,
    region: options.region,
    size: record.size,
    tags: options.tags
  }));
}

module.exports = { listObjects, uploadFiles };
