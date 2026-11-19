const crypto = require('node:crypto');

const text = (value) => Buffer.from(value).toString('base64url');
const untext = (value) => Buffer.from(value, 'base64url').toString('utf8');

function bodyWithTimes(payload, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload };
  if (options.expiresIn !== undefined) body.exp = now + options.expiresIn;
  if (options.issuedAt !== false && body.iat === undefined) body.iat = now;
  return body;
}

function signHmac(payload, secret, options = {}) {
  const header = text(JSON.stringify({ typ: 'JWT', alg: 'HS256' }));
  const body = text(JSON.stringify(bodyWithTimes(payload, options)));
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function signRsa(payload, privateKey, options = {}) {
  const header = text(JSON.stringify({ typ: 'JWT', alg: 'RS256' }));
  const body = text(JSON.stringify(bodyWithTimes(payload, options)));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(privateKey, 'base64url')}`;
}

function decodeToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('token must have three parts');
  return { header: JSON.parse(untext(parts[0])), payload: JSON.parse(untext(parts[1])), signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` };
}

function verifyToken(token, options = {}) {
  const decoded = decodeToken(token);
  const algorithm = options.algorithm || decoded.header.alg;
  let valid = false;
  if (algorithm === 'HS256') {
    const expected = crypto.createHmac('sha256', options.secret).update(decoded.signingInput).digest();
    const actual = Buffer.from(decoded.signature, 'base64url');
    valid = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } else if (algorithm === 'RS256') {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(decoded.signingInput);
    valid = verifier.verify(options.publicKey, decoded.signature, 'base64url');
  }
  if (!valid) throw new Error('invalid token signature');
  return decoded;
}

module.exports = { signHmac, signRsa, decodeToken, verifyToken };
