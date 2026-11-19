function readJson(request) {
  if (request.method === 'GET' || request.method === 'DELETE') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      text += chunk;
      if (text.length > 1024 * 1024) reject(new Error('body too large'));
    });
    request.on('end', () => {
      if (!text.trim()) return resolve(null);
      try { resolve(JSON.parse(text)); } catch { reject(new Error('invalid json')); }
    });
    request.on('error', reject);
  });
}

module.exports = { readJson };
