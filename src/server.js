'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const baseCfg = require('./config');
const { createSender } = require('./sms');
const { createOtp } = require('./otp');
const { createQr } = require('./qr');
const { openDb } = require('./db');
const { createLedger, AppError } = require('./ledger');
const sec = require('./security');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
if (baseCfg.cookieSecure) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000'; // HTTPS deployments only
const COOKIE = 'armapay_sid';

// Behind a reverse proxy every connection comes from the proxy, so the real client address is the entry the
// proxy appended to X-Forwarded-For. Count `trustProxy` hops from the right; anything further left is client-controlled.
function clientIp(req, hops = baseCfg.trustProxy) {
  const direct = req.socket.remoteAddress || 'unknown';
  if (!hops) return direct;
  const list = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return list[list.length - hops] || list[0] || direct;
}

function createApp(overrides = {}) {
  const cfg = { ...baseCfg, ...overrides };
  const db = openDb(cfg.dbFile);
  const ledger = createLedger(db, cfg);
  const sender = overrides.sender || createSender(cfg);
  const otp = createOtp(db, cfg, sender, sec);
  const qr = createQr(db, cfg, ledger);
  const limit = sec.createLimiter();

  /* ---------- helpers ---------- */
  function send(res, status, body, headers = {}) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(data), ...headers,
    });
    res.end(data);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 16 * 1024) { reject(new AppError(413, 'TOO_LARGE', 'Request too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(b && typeof b === 'object' ? b : {}); }
        catch { reject(new AppError(400, 'BAD_JSON', 'Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }
  function parseCookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  function sessionCookie(token, maxAgeMs) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${cfg.cookieSecure ? '; Secure' : ''}`;
  }
  function authUser(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token) return null;
    const row = db.prepare('SELECT s.user_id, s.expires_at FROM sessions s WHERE s.token_hash = ?').get(sec.sha256(token));
    if (!row) return null;
    if (row.expires_at < Date.now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sec.sha256(token)); return null; }
    return row.user_id;
  }
  function startSession(res, userId) {
    const token = sec.newToken();
    const t = Date.now();
    db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(sec.sha256(token), userId, t, t + cfg.sessionTtlMs);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
    return sessionCookie(token, cfg.sessionTtlMs);
  }

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const PIN_RE = /^\d{4}$|^\d{6}$/;
  const needPin = (b) => { if (!PIN_RE.test(String(b.pin || ''))) throw new AppError(400, 'BAD_PIN', 'Enter your UPI PIN'); return String(b.pin); };
  const intField = (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : NaN);

  /* ---------- routes ---------- */
  // Each handler gets {req,res,body,userId,ip,params}. Authenticated routes have userId set.
  const routes = [];
  const route = (method, pattern, opts, fn) => routes.push({ method, re: new RegExp('^' + pattern + '$'), auth: opts.auth !== false, fn });

  route('GET', '/api/health', { auth: false }, ({ res }) => send(res, 200, { ok: true, sandbox: cfg.sandbox, sms: sender.real ? 'live' : 'console', demoOtp: cfg.showDemoOtp && cfg.sandbox }));

  route('POST', '/api/register', { auth: false }, ({ res, body, ip }) => {
    const l = limit('reg:' + ip, 10, 3600000);
    if (!l.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many sign-ups. Try again later.', { retryAfterMs: l.retryAfterMs });
    const name = str(body.name, 60), mobile = str(body.mobile, 10), password = typeof body.password === 'string' ? body.password : '';
    const pin = String(body.pin || ''), handle = str(body.handle, 20).toLowerCase();
    if (name.length < 2) throw new AppError(400, 'BAD_NAME', 'Enter your full name');
    if (!/^[6-9]\d{9}$/.test(mobile)) throw new AppError(400, 'BAD_MOBILE', 'Enter a valid 10-digit mobile number');
    if (password.length < 8 || password.length > 128) throw new AppError(400, 'BAD_PASSWORD', 'Password must be at least 8 characters');
    if (!/^\d{4}$/.test(pin)) throw new AppError(400, 'BAD_PIN', 'UPI PIN must be 4 digits');
    if (handle && !/^[a-z0-9._-]{3,20}$/.test(handle)) throw new AppError(400, 'BAD_HANDLE', 'UPI handle: 3 to 20 letters, digits, . _ -');
    const user = ledger.createUser({ name, mobile, handle, passwordHash: sec.hashSecret(password), pinHash: sec.hashSecret(pin) });
    const cookie = startSession(res, user.id);
    send(res, 201, ledger.getState(user.id), { 'Set-Cookie': cookie });
  });

  route('POST', '/api/login', { auth: false }, ({ res, body, ip }) => {
    const mobile = str(body.mobile, 10), password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
    const l = limit(`login:${ip}:${mobile}`, 8, 900000);
    if (!l.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many attempts. Try again in a few minutes.', { retryAfterMs: l.retryAfterMs });
    const u = db.prepare('SELECT id, password_hash FROM users WHERE mobile = ?').get(mobile);
    const ok = sec.verifySecret(password, u ? u.password_hash : sec.DUMMY_HASH);
    if (!u || !ok) throw new AppError(401, 'BAD_LOGIN', 'Mobile number or password is wrong');
    const cookie = startSession(res, u.id);
    send(res, 200, ledger.getState(u.id), { 'Set-Cookie': cookie });
  });

  route('POST', '/api/logout', { auth: false }, ({ req, res }) => {
    const token = parseCookies(req)[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sec.sha256(token));
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  });

  // Password reset. The OTP is sent by SMS to the mobile number the account was registered with.
  route('POST', '/api/password/forgot', { auth: false }, async ({ res, body, ip }) => {
    const mobile = str(body.mobile, 10);
    if (!/^[6-9]\d{9}$/.test(mobile)) throw new AppError(400, 'BAD_MOBILE', 'Enter a valid 10-digit mobile number');
    const a = limit('otp-ip:' + ip, 10, 3600000);
    if (!a.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many requests. Try again later.', { retryAfterMs: a.retryAfterMs });
    // Same answer whether or not the number is registered, so this cannot be used to look numbers up.
    const b = limit('otp-mob:' + mobile, 1, Math.max(1, cfg.otpResendMs));
    if (!b.ok) throw new AppError(429, 'OTP_WAIT', 'Please wait a moment before asking for another OTP.', { retryAfterMs: b.retryAfterMs });
    const r = await otp.request(mobile);
    send(res, 200, {
      ok: true,
      message: 'If this number is registered, a 6-digit OTP has been sent to it by SMS.',
      resendAfterSec: Math.round(cfg.otpResendMs / 1000),
      expiresInMin: Math.round(cfg.otpTtlMs / 60000),
      ...(cfg.showDemoOtp && cfg.sandbox && r.delivered ? { demoOtp: r.code } : {}),
    });
  });

  route('POST', '/api/password/reset', { auth: false }, async ({ res, body, ip }) => {
    const mobile = str(body.mobile, 10);
    const a = limit('otp-conf-ip:' + ip, 30, 3600000);
    const b = limit('otp-conf-mob:' + mobile, 10, 900000);
    if (!a.ok || !b.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many attempts. Try again later.', { retryAfterMs: Math.max(a.retryAfterMs, b.retryAfterMs) });
    await otp.reset({ mobile, otp: str(body.otp, 6), newPassword: typeof body.newPassword === 'string' ? body.newPassword : '' });
    send(res, 200, { ok: true, message: 'Your password has been changed. Sign in with the new password.' });
  });

  route('GET', '/api/state', {}, ({ res, userId }) => send(res, 200, ledger.getState(userId)));

  route('POST', '/api/resolve', {}, ({ res, body, userId }) => send(res, 200, ledger.resolve(userId, body.q)));

  route('POST', '/api/pay', {}, ({ res, body, userId }) => {
    const l = limit('pay:' + userId, 30, 60000);
    if (!l.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many payments. Slow down.', { retryAfterMs: l.retryAfterMs });
    const amount = intField(body.amount);
    if (!Number.isFinite(amount)) throw new AppError(400, 'BAD_AMOUNT', 'Enter a valid amount');
    const idemKey = str(body.idemKey, 64) || null;
    // A replayed idempotency key returns the first result without asking for the PIN again.
    if (idemKey) {
      const ex = ledger.one('SELECT ref FROM transactions WHERE payer_user = ? AND idem_key = ?', userId, idemKey);
      if (ex) { const st = ledger.getState(userId); return send(res, 200, { replay: true, txn: st.txns.find((t) => t.id === ex.ref), state: st }); }
    }
    // A payment that started from a QR must carry the id of that QR's safety check. A high-risk QR needs an explicit acknowledgement.
    let qrRow = null;
    if (body.qrCheck !== undefined) {
      qrRow = qr.verifyCheck(userId, body.qrCheck, body.to);
      if (qrRow.score >= cfg.qrHighRisk && body.riskAck !== true) throw new AppError(400, 'RISK_ACK_REQUIRED', 'This QR was flagged as high risk. Confirm that you understand the warning before paying.');
    }
    ledger.verifyPin(userId, needPin(body));
    const { txn, replay } = ledger.pay({ userId, to: body.to, amount, note: body.note, accountId: intField(body.accountId), idemKey, saveContact: !!body.saveContact });
    if (qrRow && !replay) ledger.audit(userId, 'pay_qr', { ref: txn.ref, score: qrRow.score, acknowledged: body.riskAck === true });
    const st = ledger.getState(userId);
    send(res, 200, { replay, txn: st.txns.find((t) => t.id === txn.ref), state: st });
  });

  route('POST', '/api/txns/([A-Z0-9]+)/undo', {}, ({ res, body, userId, params }) => {
    ledger.verifyPin(userId, needPin(body));
    const r = ledger.undo({ userId, ref: params[0], reason: str(body.reason, 20), mode: body.mode === 'dispute' ? 'dispute' : 'undo' });
    const st = ledger.getState(userId);
    send(res, 200, { mode: r.mode, ticket: r.ticket || null, txn: st.txns.find((t) => t.id === params[0]), state: st });
  });

  route('POST', '/api/balance', {}, ({ res, body, userId }) => {
    ledger.verifyPin(userId, needPin(body));
    const b = ledger.balance(userId, intField(body.accountId));
    send(res, 200, { balance: b.balance, bank: b.bank_name, last4: b.last4 });
  });

  route('POST', '/api/contacts', {}, ({ res, body, userId }) => {
    const c = ledger.addContact(userId, body.q, body.type);
    send(res, 201, { contact: c, state: ledger.getState(userId) });
  });

  route('POST', '/api/requests', {}, ({ res, body, userId }) => {
    ledger.createRequest(userId, body.to, intField(body.amount), body.note);
    send(res, 201, { state: ledger.getState(userId) });
  });

  // Approving a collect request PAYS the requester. It needs the PIN and an explicit acknowledgement (ack: true).
  route('POST', '/api/requests/(\\d+)/approve', {}, ({ res, body, userId, params }) => {
    const l = limit('pay:' + userId, 30, 60000);
    if (!l.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many payments. Slow down.', { retryAfterMs: l.retryAfterMs });
    if (body.ack !== true) throw new AppError(400, 'ACK_REQUIRED', 'Confirm that you understand this request takes money out of your account.');
    ledger.verifyPin(userId, needPin(body));
    const r = ledger.approveCollect({ userId, id: Number(params[0]), accountId: intField(body.accountId), ack: true, idemKey: str(body.idemKey, 64) || null });
    if (r.expired) throw new AppError(410, 'EXPIRED', 'This request has expired');
    const st = ledger.getState(userId);
    send(res, 200, { txn: st.txns.find((t) => t.id === r.txn.ref), state: st });
  });
  route('POST', '/api/requests/(\\d+)/decline', {}, ({ res, body, userId, params }) => {
    ledger.declineCollect({ userId, id: Number(params[0]), report: body.report === true });
    send(res, 200, ledger.getState(userId));
  });

  route('POST', '/api/primary', {}, ({ res, body, userId }) => {
    ledger.setPrimary(userId, intField(body.accountId));
    send(res, 200, ledger.getState(userId));
  });

  route('POST', '/api/pin/change', {}, ({ res, body, userId }) => {
    if (!/^\d{4}$/.test(String(body.newPin || ''))) throw new AppError(400, 'BAD_PIN', 'New PIN must be 4 digits');
    ledger.changePin(userId, String(body.oldPin || ''), String(body.newPin));
    send(res, 200, { ok: true });
  });

  // QR safety check. Reads the QR, looks up its history and returns a risk score (0..99, 50+ = fraud alert) before any money moves.
  route('POST', '/api/qr/check', {}, ({ res, body, userId }) => {
    const l = limit('qr:' + userId, 60, 60000);
    if (!l.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many scans. Slow down.', { retryAfterMs: l.retryAfterMs });
    send(res, 200, qr.check(userId, typeof body.payload === 'string' ? body.payload : ''));
  });
  route('POST', '/api/qr/report', {}, ({ res, body, userId }) => {
    const l = limit('qrr:' + userId, 20, 86400000);
    if (!l.ok) throw new AppError(429, 'RATE_LIMIT', 'Too many reports today.', { retryAfterMs: l.retryAfterMs });
    send(res, 200, { ok: true, ...qr.report(userId, body.vpa, str(body.reason, 12)) });
  });

  // Sandbox-only tools. They answer 404 when SANDBOX=0.
  route('POST', '/api/sandbox/add-money', {}, ({ res, body, userId }) => {
    const amt = intField(body.amount);
    if (!(amt > 0 && amt <= 100000 * 100)) throw new AppError(400, 'BAD_AMOUNT', 'Enter a valid amount');
    ledger.sandboxAddMoney(userId, amt);
    send(res, 200, { ok: true });
  });
  route('POST', '/api/sandbox/spend', {}, ({ res, body, userId }) => {
    const r = ledger.sandboxSpend(userId, str(body.ref, 20));
    send(res, 200, { ok: true, kept: r.kept });
  });
  route('POST', '/api/sandbox/demo-qrs', {}, ({ res }) => send(res, 200, { items: qr.demoQrs() }));
  route('POST', '/api/sandbox/incoming-collect', {}, ({ res, body, userId }) => {
    ledger.sandboxIncomingCollect(userId, body.kind === 'contact' ? 'contact' : 'scam');
    send(res, 200, ledger.getState(userId));
  });
  route('POST', '/api/sandbox/request-paid', {}, ({ res, body, userId }) => {
    ledger.sandboxRequestPaid(userId, intField(body.id));
    send(res, 200, ledger.getState(userId));
  });

  /* ---------- static files ---------- */
  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400, SECURITY_HEADERS); return res.end(); }
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403, SECURITY_HEADERS); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      const ext = path.extname(file).toLowerCase();
      const cache = rel === '/sw.js' || ext === '.html' || rel === '/manifest.webmanifest' ? 'no-cache'
        : ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  /* ---------- request handler ---------- */
  const server = http.createServer(async (req, res) => {
    const ip = clientIp(req, cfg.trustProxy);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
        return serveStatic(req, res, url.pathname);
      }
      let matched = null, params = [];
      for (const r of routes) {
        const m = url.pathname.match(r.re);
        if (m && r.method === req.method) { matched = r; params = m.slice(1); break; }
      }
      if (!matched) {
        const pathExists = routes.some((r) => r.re.test(url.pathname));
        throw new AppError(pathExists ? 405 : 404, pathExists ? 'METHOD' : 'NOT_FOUND', pathExists ? 'Method not allowed' : 'Not found');
      }
      let body = {};
      if (req.method !== 'GET') {
        // Custom header + JSON content type: a cross-site form or fetch cannot send these without a CORS preflight, which we never grant.
        if (req.headers['x-armapay'] !== '1') throw new AppError(403, 'CSRF', 'Missing request header');
        if (!String(req.headers['content-type'] || '').startsWith('application/json') && Number(req.headers['content-length'] || 0) > 0)
          throw new AppError(415, 'CONTENT_TYPE', 'Use application/json');
        body = await readBody(req);
      }
      let userId = null;
      if (matched.auth) {
        userId = authUser(req);
        if (!userId) throw new AppError(401, 'AUTH', 'Please sign in');
      }
      await matched.fn({ req, res, body, userId, ip, params });
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof AppError) return send(res, e.status, { error: { code: e.code, message: e.message, ...(e.extra || {}) } });
      if (e && String(e.code || '').startsWith('SQLITE_CONSTRAINT')) return send(res, 409, { error: { code: 'CONFLICT', message: 'That could not be completed. Please try again.' } });
      console.error('Unhandled error:', e);
      send(res, 500, { error: { code: 'SERVER', message: 'Something went wrong on our side.' } });
    }
  });

  return { server, db, ledger, cfg, close: () => new Promise((r) => server.close(() => { db.close(); r(); })) };
}

// Start listening and shut down cleanly (so SQLite closes its files) when the host stops the process.
function start(overrides) {
  const app = createApp(overrides);
  app.server.on('error', (e) => { console.error('Server error:', e.message); process.exit(1); });
  app.server.listen(app.cfg.port, app.cfg.host, () => {
    console.log(`ARMAPay listening on http://${app.cfg.host}:${app.cfg.port} (sandbox: ${app.cfg.sandbox}, db: ${app.cfg.dbFile}, driver: ${app.db.driver})`);
  });
  const stop = () => { app.close().then(() => process.exit(0), () => process.exit(1)); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return app;
}

// `npm run dev`: show the reset OTP on screen (there is no SMS gateway on a laptop) unless the environment says otherwise.
if (require.main === module) start(process.env.DEMO_SHOW_OTP === undefined ? { showDemoOtp: true } : undefined);

module.exports = { createApp, start };
