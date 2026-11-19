function readBody(req, limit = 262144) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
      else tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('request too large'), { code: 'TOO_LARGE' }));
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

module.exports = { readBody };
