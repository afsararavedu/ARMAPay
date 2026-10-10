'use strict';
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(secret), salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifySecret(secret, stored) {
  try {
    const [scheme, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(secret), salt, expected.length, SCRYPT);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used when a user does not exist, so login timing does not reveal which mobiles are registered.
const DUMMY_HASH = hashSecret('armapay-dummy-secret');

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Small in-memory fixed-window limiter. Use Redis or the API gateway for more than one server process.
function createLimiter() {
  const hits = new Map();
  return function limit(key, max, windowMs) {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.count++;
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    return { ok: h.count <= max, retryAfterMs: Math.max(0, h.reset - now) };
  };
}

module.exports = { hashSecret, verifySecret, DUMMY_HASH, newToken, sha256, createLimiter };
