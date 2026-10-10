'use strict';
// Payment QR codes: parse them, look up their history, and score the risk BEFORE any money moves.
//
// The score runs 0..99. 50 and above means "fraud detected": the app shows the alert and the server
// refuses to pay unless the user explicitly acknowledges the warning (see /api/pay, qrCheck + riskAck).
// 99 is the ceiling on purpose: no scan can prove a payee is 100% a fraudster or 100% safe.
const crypto = require('crypto');
const { AppError, SCAM_WORDS } = require('./ledger');

class QrError extends AppError {
  constructor(kind, message) { super(422, 'NOT_UPI_QR', message, { kind }); }
}

const VPA_RE = /^[a-z0-9._-]{2,64}@[a-z]{2,32}$/;
// Zero-width and bidirectional-override characters let a name read differently than it is stored.
const INVISIBLE = /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g;
const clean = (s, max) => String(s || '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, max);

function toPaise(str) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(str)) return NaN;
  const [r, p = ''] = str.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}

/* ---------- parsing ---------- */
function parseUpiLink(raw) {
  const m = raw.match(/^upi:(?:\/\/)?pay\/?\?(.*)$/is);
  if (!m) throw new QrError('not_upi', 'This is not a UPI payment QR code.');
  const q = {};
  for (const kv of m[1].split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    if (i < 1) continue;
    const key = kv.slice(0, i).toLowerCase();
    let val;
    try { val = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch { throw new QrError('tampered', 'This QR code is malformed.'); }
    // Repeating pa or am is a known trick: one app reads the first value, another the last.
    if (key in q) throw new QrError('tampered', 'This QR code repeats a field (for example the payee). It may have been tampered with.');
    q[key] = val;
  }
  const vpa = clean(q.pa, 100).toLowerCase();
  if (!VPA_RE.test(vpa)) throw new QrError('bad_vpa', 'This QR code does not contain a valid UPI ID.');
  if (q.cu && q.cu.toUpperCase() !== 'INR') throw new QrError('bad_currency', 'Only INR payments are supported.');
  let amount = null;
  if (q.am !== undefined && q.am !== '') {
    amount = toPaise(String(q.am).trim());
    if (!Number.isFinite(amount)) throw new QrError('bad_amount', 'The amount in this QR code is not valid.');
    if (amount === 0) amount = null;
  }
  return { scheme: 'upi', vpa, name: clean(q.pn, 60), amount, note: clean(q.tn, 50), mcc: /^\d{4}$/.test(q.mc || '') ? q.mc : '', ref: clean(q.tr, 35) };
}

// BharatQR / EMVCo merchant QR: a chain of tag(2) length(2) value. UPI details sit inside tags 26 to 51.
function tlv(str) {
  const out = [];
  for (let i = 0; i < str.length;) {
    const lenStr = str.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lenStr)) throw new QrError('tampered', 'This QR code is malformed.');
    const len = Number(lenStr), val = str.slice(i + 4, i + 4 + len);
    if (val.length !== len) throw new QrError('tampered', 'This QR code is malformed.');
    out.push([str.slice(i, i + 2), val]);
    i += 4 + len;
  }
  return out;
}
function parseEmv(raw) {
  const top = new Map(tlv(raw));
  let vpa = '';
  for (let t = 26; t <= 51 && !vpa; t++) {
    const v = top.get(String(t));
    if (!v) continue;
    let subs; try { subs = tlv(v); } catch { continue; }
    for (const [, sv] of subs) { const c = sv.toLowerCase(); if (VPA_RE.test(c)) { vpa = c; break; } }
  }
  if (!vpa) throw new QrError('not_upi', 'This merchant QR code has no UPI ID in it, so ARMAPay cannot pay it.');
  let amount = null;
  if (top.get('54')) { amount = toPaise(top.get('54')); if (!Number.isFinite(amount)) throw new QrError('bad_amount', 'The amount in this QR code is not valid.'); if (amount === 0) amount = null; }
  if (top.get('53') && top.get('53') !== '356') throw new QrError('bad_currency', 'Only INR payments are supported.');
  return { scheme: 'emv', vpa, name: clean(top.get('59'), 60), amount, note: '', mcc: /^\d{4}$/.test(top.get('52') || '') ? top.get('52') : '', ref: '' };
}

function parseQr(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new QrError('empty', 'No QR code was read.');
  if (raw.length > 1024) throw new QrError('too_long', 'This QR code is too long to be a payment code.');
  if (/^upi:(?:\/\/)?mandate/i.test(raw)) throw new QrError('mandate', 'This QR code sets up a recurring auto-debit, not a one-time payment. ARMAPay will not open it.');
  if (/^upi:/i.test(raw)) return parseUpiLink(raw);
  if (/^000201/.test(raw)) return parseEmv(raw);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^www\./i.test(raw)) throw new QrError('url', 'This QR code opens a website, not a payment. ARMAPay will not open it.');
  throw new QrError('not_upi', 'This is not a UPI payment QR code.');
}

/* ---------- risk ---------- */
const nameKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
function sameName(a, b) {
  const x = nameKey(a), y = nameKey(b);
  if (!x.length || !y.length) return true; // nothing to compare
  const set = new Set(y);
  return x.some((w) => set.has(w)) || y.some((w) => x.includes(w));
}

function createQr(db, cfg, ledger) {
  const now = () => Date.now();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const rupees = (p) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

  function lookupPayee(userId, vpa) {
    const user = one('SELECT id, name, created_at FROM users WHERE vpa = ?', vpa);
    const ext = user ? null : one('SELECT display_name FROM accounts WHERE user_id IS NULL AND vpa = ?', vpa);
    const saved = one('SELECT name FROM contacts WHERE user_id = ? AND lower(vpa) = ?', userId, vpa);
    return {
      registered: !!user, self: !!user && user.id === userId,
      verifiedName: user ? user.name : ext ? ext.display_name : null,
      // Sandbox bank names for outside IDs are made up, so only a real bank answer can contradict a QR name.
      nameIsTrusted: !!user || (!!ext && !cfg.sandbox),
      ageMs: user ? now() - user.created_at : null,
      saved: !!saved, savedName: saved ? saved.name : null,
    };
  }

  // Everything known about this payee, from every kind of report.
  function history(vpa) {
    const since = now() - cfg.abuseWindowMs;
    const minAge = now() - cfg.qrReporterMinAgeMs;
    const reporters = new Set();
    for (const r of all(
      'SELECT r.id, r.reporter_user FROM qr_reports r LEFT JOIN users u ON u.id = r.reporter_user WHERE r.vpa = ? AND r.created_at >= ? AND (r.reporter_user IS NULL OR u.created_at <= ?)',
      vpa, since, minAge
    )) reporters.add(r.reporter_user ? 'u' + r.reporter_user : 'q' + r.id);
    for (const r of all(
      "SELECT DISTINCT t.payer_user AS p FROM undo_log l JOIN transactions t ON t.id = l.txn_id WHERE lower(t.payee_vpa) = ? AND l.reason != 'wrong' AND l.created_at >= ?", vpa, since
    )) reporters.add('u' + r.p);
    for (const r of all(
      'SELECT DISTINCT payer_user AS p FROM collect_requests WHERE lower(requester_vpa) = ? AND reported = 1 AND payer_user IS NOT NULL AND created_at >= ?', vpa, since
    )) reporters.add('u' + r.p);

    const scans = one('SELECT COUNT(*) c, COUNT(DISTINCT COALESCE(user_id, -id)) d, MIN(created_at) f FROM qr_checks WHERE vpa = ?', vpa);
    const paidBy = one("SELECT COUNT(DISTINCT payer_user) c FROM transactions WHERE lower(payee_vpa) = ? AND status = 'SUCCESS'", vpa).c;
    return { reports: reporters.size, scans: scans.c, scanners: scans.d, firstSeen: scans.f || null, paidBy };
  }

  function assess(q, payee, h) {
    const reasons = [];
    const add = (code, points, text) => { if (points) reasons.push({ code, points, text, kind: points >= 20 ? 'bad' : points > 0 ? 'warn' : 'good' }); };

    if (h.reports >= 3) add('reports', 85, `${h.reports} different people reported this payee as fraud or a scam.`);
    else if (h.reports === 2) add('reports', 65, '2 different people reported this payee as fraud or a scam.');
    else if (h.reports === 1) add('reports', 45, '1 person reported this payee as fraud or a scam.');

    if (h.scans === 0 && h.paidBy === 0) add('first_seen', 15, 'No one on ARMAPay has scanned or paid this payee before.');
    if (payee.registered && payee.ageMs != null && payee.ageMs < 7 * 86400000) add('new_account', 15, 'This ARMAPay account was opened less than 7 days ago.');
    if (payee.nameIsTrusted && payee.verifiedName && q.name && !sameName(q.name, payee.verifiedName)) {
      add('name_mismatch', 25, `The QR says “${q.name}” but the bank-verified name is “${payee.verifiedName}”.`);
    } else if (!payee.verifiedName) add('unverified_name', 10, 'We could not verify the name behind this UPI ID.');

    if (payee.saved) add('saved', -15, `In your contacts as ${payee.savedName}.`);
    else add('not_saved', 10, 'Not in your contacts.');

    if (SCAM_WORDS.test(q.name + ' ' + q.note)) add('scam_words', 20, 'The name or note uses words scammers use, such as refund, receive, cashback or prize.');
    if (q.amount != null && q.amount >= 10000 * 100) add('large_amount', 10, `The QR asks for a large amount (${rupees(q.amount)}).`);
    if (h.reports === 0 && h.paidBy >= 5) add('trusted', -20, `Paid by ${h.paidBy} ARMAPay users with no reports.`);

    let score = reasons.reduce((s, r) => s + r.points, 0);
    // Reports are the strongest evidence. Good signals can soften them but never hide them.
    if (h.reports >= 2) score = Math.max(score, cfg.qrHighRisk + 5);
    else if (h.reports === 1) {
      // One report is a warning, not a verdict: a single (possibly mistaken or malicious) report can raise the
      // alarm to "be careful" but not to "fraud detected" unless the QR itself also looks wrong.
      const corroborated = reasons.some((r) => r.code === 'name_mismatch' || r.code === 'scam_words');
      score = Math.max(score, cfg.qrCaution);
      if (!corroborated) score = Math.min(score, cfg.qrHighRisk - 1);
    }
    score = Math.max(0, Math.min(99, Math.round(score)));
    const level = score >= cfg.qrHighRisk ? 'high' : score >= cfg.qrCaution ? 'caution' : 'low';
    const label = { high: 'Fraud detected', caution: 'Be careful', low: 'Low risk' }[level];
    const summary = {
      high: 'Possible fraud detected. Do not pay unless you personally know and trust this payee.',
      caution: 'Be careful. Check the name and amount before you pay.',
      low: 'No reports found for this payee. Still check the name before you pay.',
    }[level];
    reasons.sort((a, b) => b.points - a.points);
    return { score, level, label, summary, reasons, caution: cfg.qrCaution, high: cfg.qrHighRisk };
  }

  function check(userId, raw) {
    const q = parseQr(raw);
    const payee = lookupPayee(userId, q.vpa);
    if (payee.self) throw new AppError(400, 'SELF_PAY', "That's your own QR code");
    const h = history(q.vpa); // history BEFORE this scan, so "first time seen" is honest
    const risk = assess(q, payee, h);
    const checkId = crypto.randomBytes(12).toString('base64url');
    run('INSERT INTO qr_checks(check_id,user_id,vpa,fp,amount,score,level,created_at) VALUES(?,?,?,?,?,?,?,?)',
      checkId, userId, q.vpa, crypto.createHash('sha256').update(raw.trim()).digest('hex'), q.amount, risk.score, risk.level, now());
    ledger.audit(userId, 'qr_check', { vpa: q.vpa, score: risk.score });
    return {
      checkId,
      validForMs: cfg.qrCheckTtlMs,
      payee: { vpa: q.vpa, qrName: q.name, verifiedName: payee.verifiedName, name: payee.savedName || payee.verifiedName || q.name || q.vpa, saved: payee.saved, registered: payee.registered, mcc: q.mcc },
      amount: q.amount, note: q.note,
      risk,
      history: { reports: h.reports, scans: h.scans, scanners: h.scanners, firstSeen: h.firstSeen, paidBy: h.paidBy },
    };
  }

  // The pay endpoint calls this to prove the QR was checked, and to learn how risky it was.
  function verifyCheck(userId, checkId, vpa) {
    const row = typeof checkId === 'string' ? one('SELECT * FROM qr_checks WHERE check_id = ?', checkId) : null;
    if (!row || row.user_id !== userId) throw new AppError(400, 'QR_CHECK_INVALID', 'Scan the QR code again before paying.');
    if (now() - row.created_at > cfg.qrCheckTtlMs) throw new AppError(400, 'QR_CHECK_EXPIRED', 'This QR check has expired. Scan the QR code again.');
    if (String(vpa || '').toLowerCase() !== row.vpa) throw new AppError(400, 'QR_CHECK_MISMATCH', 'This payment does not match the QR code you scanned.');
    return row;
  }

  function report(userId, vpaIn, reason) {
    const vpa = String(vpaIn || '').trim().toLowerCase();
    if (!VPA_RE.test(vpa)) throw new AppError(400, 'BAD_PAYEE', 'Enter a valid UPI ID');
    if (!['fraud', 'scam', 'cheating', 'other'].includes(reason)) throw new AppError(400, 'BAD_REASON', 'Choose a reason');
    const me = one('SELECT vpa FROM users WHERE id = ?', userId);
    if (me.vpa === vpa) throw new AppError(400, 'SELF_PAY', "That's your own account");
    // Only people who have actually met this payee (scanned, paid or been asked for money) can report it.
    const met = one('SELECT 1 x FROM qr_checks WHERE user_id = ? AND vpa = ?', userId, vpa)
      || one('SELECT 1 x FROM transactions WHERE payer_user = ? AND lower(payee_vpa) = ?', userId, vpa)
      || one('SELECT 1 x FROM collect_requests WHERE payer_user = ? AND lower(requester_vpa) = ?', userId, vpa);
    if (!met) throw new AppError(403, 'NOT_ALLOWED', 'You can only report a payee you have scanned, paid or received a request from.');
    const ex = one('SELECT id FROM qr_reports WHERE reporter_user = ? AND vpa = ?', userId, vpa);
    if (ex) run('UPDATE qr_reports SET reason = ?, created_at = ? WHERE id = ?', reason, now(), ex.id); // one report per person
    else run('INSERT INTO qr_reports(reporter_user,vpa,reason,created_at) VALUES(?,?,?,?)', userId, vpa, reason, now());
    ledger.audit(userId, 'qr_report', { vpa, reason });
    return { reports: history(vpa).reports };
  }

  // Sandbox only: three printable QR codes that land in the three zones, with matching history.
  function demoQrs() {
    if (!cfg.sandbox) throw new AppError(404, 'NOT_FOUND', 'Not found');
    const t = now();
    const seedScans = (vpa, n) => {
      if (one('SELECT 1 x FROM qr_checks WHERE vpa = ? AND user_id IS NULL', vpa)) return;
      for (let i = 0; i < n; i++) run('INSERT INTO qr_checks(check_id,user_id,vpa,fp,amount,score,level,created_at) VALUES(?,NULL,?,?,NULL,5,?,?)', 'seed-' + crypto.randomBytes(6).toString('hex'), vpa, 'seed', 'low', t - (i + 1) * 3600000);
    };
    const seedReports = (vpa, n, reasons) => {
      if (one('SELECT 1 x FROM qr_reports WHERE vpa = ? AND reporter_user IS NULL', vpa)) return;
      for (let i = 0; i < n; i++) run('INSERT INTO qr_reports(reporter_user,vpa,reason,created_at) VALUES(NULL,?,?,?)', vpa, reasons[i % reasons.length], t - (i + 1) * 7200000);
    };
    const ensure = (vpa, name) => { if (!one('SELECT 1 x FROM accounts WHERE user_id IS NULL AND vpa = ?', vpa)) ledger.createExternal(vpa, name, 5000 * 100); };

    ensure('greenroots@okhdfc', 'Green Roots Organic Farm');
    seedScans('greenroots@okhdfc', 12);
    ensure('cashback.rewards@okpay', 'Cashback Rewards');
    seedScans('cashback.rewards@okpay', 9);
    seedReports('cashback.rewards@okpay', 2, ['scam', 'fraud']);
    const link = (o) => 'upi://pay?' + Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    return [
      { kind: 'low', title: 'Trusted organic farm', note: 'Saved contact with a clean history', payload: link({ pa: 'greenroots@okhdfc', pn: 'Green Roots Organic Farm', mc: '5411', cu: 'INR', am: '1200' }) },
      { kind: 'caution', title: 'Roadside vegetable stall', note: 'Nobody has paid this UPI ID before', payload: link({ pa: 'fresh.veg.stall@okaxis', pn: 'Fresh Veg Stall', cu: 'INR', am: '490', tn: 'Vegetables' }) },
      { kind: 'high', title: 'Cashback rewards', note: 'Reported by other users as a scam', payload: link({ pa: 'cashback.rewards@okpay', pn: 'Cashback Rewards', cu: 'INR', am: '2500', tn: 'Scan to receive cashback' }) },
    ];
  }

  return { parse: parseQr, check, verifyCheck, report, demoQrs, history };
}

module.exports = { createQr, parseQr, QrError };
