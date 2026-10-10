'use strict';
const crypto = require('crypto');
const { hashSecret, verifySecret } = require('./security');

class AppError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const REASONS = ['fraud', 'scam', 'laundering', 'wrong'];
// Words scammers put in names and notes. Used for collect requests and for QR risk.
const SCAM_WORDS = /refund|prize|lottery|reward|cashback|kyc|customer care|support|verify|receive|claim|winner|gift|advance|token amount|deposit|insurance|bonus|olx|buyer/i;
const NAMES = ['Suresh Reddy', 'Kavya Nair', 'Imran Sheikh', 'Divya Menon', 'Arjun Patel', 'Sana Fatima', 'Karthik Rao', 'Pooja Verma'];
const DEMO_CONTACTS = [
  { name: 'Ravi Kumar', vpa: 'ravi.k@ybl', mobile: '9845012345', type: 'person', funds: 4200 },
  { name: 'Meera Subramanian', vpa: 'meera.s@armapay', mobile: '9900123456', type: 'person', funds: 1800 },
  { name: 'Green Roots Organic Farm', vpa: 'greenroots@okhdfc', mobile: '8123456780', type: 'merchant', funds: 52000 },
  { name: 'Ananth Traders', vpa: 'ananth.traders@oksbi', mobile: '9700011122', type: 'merchant', funds: 15000 },
  { name: 'Lakshmi Devi', vpa: 'lakshmi.d@paytm', mobile: '9246677889', type: 'person', funds: 900 },
];

const rs = (paise) => '\u20B9' + (paise / 100).toLocaleString('en-IN');
const rrn = () => String(crypto.randomInt(1e11, 1e12));
const newRef = () => 'T' + crypto.randomBytes(6).toString('hex').toUpperCase();
const hashN = (s) => { let h = 7; for (const ch of s) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return h; };

function createLedger(db, cfg) {
  const now = () => Date.now();
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const tx = (fn) => db.transaction(fn).immediate();

  function audit(userId, action, detail) {
    run('INSERT INTO audit(ts,user_id,action,detail) VALUES(?,?,?,?)', now(), userId || null, action, detail ? JSON.stringify(detail) : null);
  }

  /* ---------- low-level balance moves (always mirrored in ledger_entries) ---------- */
  function entry(txnId, accountId, delta, kind) {
    run('INSERT INTO ledger_entries(txn_id,account_id,delta,kind,created_at) VALUES(?,?,?,?,?)', txnId, accountId, delta, kind, now());
  }
  function debit(accountId, amt, txnId, kind) {
    const r = run('UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?', amt, accountId, amt);
    if (r.changes !== 1) throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Not enough balance in this account');
    entry(txnId, accountId, -amt, kind);
  }
  function creditRaw(accountId, amt, txnId, kind) {
    run('UPDATE accounts SET balance = balance + ? WHERE id = ?', amt, accountId);
    entry(txnId, accountId, amt, kind);
  }
  // A normal incoming credit. Any open lien on the account is paid out of this credit first.
  function credit(accountId, amt, txnId, kind) {
    creditRaw(accountId, amt, txnId, kind);
    captureLiens(accountId, amt);
  }
  function captureLiens(accountId, credited) {
    let avail = credited;
    const liens = all("SELECT * FROM liens WHERE account_id = ? AND status = 'OPEN' ORDER BY id", accountId);
    for (const l of liens) {
      if (avail <= 0) break;
      const cap = Math.min(l.amount, avail);
      debit(accountId, cap, l.txn_id, 'lien_capture_debit');
      creditRaw(l.claimant_account, cap, l.txn_id, 'lien_capture_credit');
      avail -= cap;
      const left = l.amount - cap;
      run('UPDATE liens SET amount = ?, status = ? WHERE id = ?', left, left === 0 ? 'SETTLED' : 'OPEN', l.id);
      run(
        "UPDATE transactions SET rev_recovered = rev_recovered + ?, status = CASE WHEN rev_lien - ? = 0 THEN 'REVERSED' ELSE status END, rev_lien = rev_lien - ? WHERE id = ?",
        cap, cap, cap, l.txn_id
      );
    }
  }

  /* ---------- parties ---------- */
  function createExternal(vpa, name, funds) {
    const display = name || NAMES[hashN(vpa) % NAMES.length];
    const start = funds != null ? funds : 300 * 100 + (hashN(vpa) % 2700) * 100;
    const id = run(
      "INSERT INTO accounts(user_id,vpa,display_name,bank_name,last4,balance,is_primary) VALUES(NULL,?,?,'External UPI','0000',0,0)",
      vpa, display
    ).lastInsertRowid;
    if (start > 0) creditRaw(id, start, null, 'sandbox_fund');
    return one('SELECT * FROM accounts WHERE id = ?', id);
  }

  function reportsAgainst(accountId) {
    const since = now() - cfg.abuseWindowMs;
    const undos = one(
      "SELECT COUNT(*) c FROM undo_log u JOIN transactions t ON t.id = u.txn_id WHERE t.to_account = ? AND u.reason != 'wrong' AND u.created_at >= ?",
      accountId, since
    ).c;
    const a = one('SELECT a.vpa AS avpa, u.vpa AS uvpa FROM accounts a LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?', accountId);
    const vpa = a && (a.avpa || a.uvpa);
    const collects = vpa ? one('SELECT COUNT(*) c FROM collect_requests WHERE requester_vpa = ? AND reported = 1 AND created_at >= ?', vpa, since).c : 0;
    const qrs = vpa ? one('SELECT COUNT(*) c FROM qr_reports WHERE vpa = ? AND created_at >= ?', vpa.toLowerCase(), since).c : 0;
    return undos + collects + qrs;
  }

  function findParty(userId, input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) throw new AppError(400, 'BAD_PAYEE', 'Enter a name, mobile number or UPI ID');
    const lc = s.toLowerCase();
    const c = one('SELECT * FROM contacts WHERE user_id = ? AND (lower(vpa) = ? OR mobile = ? OR lower(name) = ?)', userId, lc, s, lc);
    let vpa, mobile = '';
    if (c) { vpa = c.vpa.toLowerCase(); mobile = c.mobile; }
    else if (/^[6-9]\d{9}$/.test(s)) {
      const u = one('SELECT vpa FROM users WHERE mobile = ?', s);
      vpa = u ? u.vpa : `${s}@armapay`;
      mobile = s;
    } else if (/^[a-z0-9._-]{2,}@[a-z]{2,}$/.test(lc)) vpa = lc;
    else throw new AppError(400, 'BAD_PAYEE', 'Enter a valid UPI ID (name@bank) or a 10-digit mobile number');

    const u = one('SELECT * FROM users WHERE vpa = ?', vpa);
    let account, name, toUser = null;
    if (u) {
      if (u.id === userId) throw new AppError(400, 'SELF_PAY', "That's your own account");
      account = one('SELECT * FROM accounts WHERE user_id = ? AND is_primary = 1', u.id);
      name = u.name;
      toUser = u.id;
    } else {
      account = one('SELECT * FROM accounts WHERE user_id IS NULL AND vpa = ?', vpa);
      if (!account) {
        if (!cfg.sandbox) throw new AppError(404, 'VPA_NOT_FOUND', 'This UPI ID could not be verified');
        account = createExternal(vpa);
      }
      name = account.display_name;
    }
    return {
      vpa, mobile, name: c ? c.name : name, verifiedName: name, saved: !!c, type: c ? c.type : 'person',
      contactId: c ? c.id : null, account, toUser, registered: !!u,
    };
  }

  function resolve(userId, input) {
    const p = findParty(userId, input);
    return { name: p.name, verifiedName: p.verifiedName, vpa: p.vpa, mobile: p.mobile, saved: p.saved, type: p.type, registered: p.registered, reports: reportsAgainst(p.account.id) };
  }

  /* ---------- users ---------- */
  function createUser({ name, mobile, handle, passwordHash, pinHash }) {
    return tx(() => {
      const vpa = `${handle || mobile}@armapay`.toLowerCase();
      if (one('SELECT 1 x FROM users WHERE mobile = ?', mobile)) throw new AppError(409, 'MOBILE_TAKEN', 'This mobile number is already registered');
      if (one('SELECT 1 x FROM users WHERE vpa = ?', vpa) || one('SELECT 1 x FROM accounts WHERE user_id IS NULL AND vpa = ?', vpa))
        throw new AppError(409, 'HANDLE_TAKEN', 'This UPI handle is taken');
      const id = run('INSERT INTO users(mobile,name,vpa,password_hash,pin_hash,created_at) VALUES(?,?,?,?,?,?)', mobile, name, vpa, passwordHash, pinHash, now()).lastInsertRowid;
      if (cfg.sandbox) {
        const banks = [['State Bank of India', 1], ['HDFC Bank', 0]];
        banks.forEach(([bank, primary], i) => {
          const accId = run(
            'INSERT INTO accounts(user_id,bank_name,last4,balance,is_primary) VALUES(?,?,?,0,?)',
            id, bank, String(crypto.randomInt(1000, 10000)), primary
          ).lastInsertRowid;
          creditRaw(accId, cfg.openingBalances[i], null, 'opening');
        });
        for (const d of DEMO_CONTACTS) {
          let acc = one('SELECT * FROM accounts WHERE user_id IS NULL AND vpa = ?', d.vpa);
          if (!acc) acc = createExternal(d.vpa, d.name, d.funds * 100);
          run('INSERT INTO contacts(user_id,name,vpa,mobile,type,created_at) VALUES(?,?,?,?,?,?)', id, d.name, d.vpa, d.mobile, d.type, now());
        }
      } else {
        run("INSERT INTO accounts(user_id,bank_name,last4,balance,is_primary) VALUES(?,'Unlinked bank','0000',0,1)", id);
      }
      audit(id, 'register', { vpa });
      return one('SELECT * FROM users WHERE id = ?', id);
    });
  }

  // Returns {ok:true} or throws AppError. Counts failures and locks the PIN after pinMaxFails.
  function verifyPin(userId, pin) {
    // The failure counter must be committed even when the PIN is wrong, so the outcome is
    // returned from the transaction and the error is thrown only after it has committed.
    const outcome = tx(() => {
      const u = one('SELECT * FROM users WHERE id = ?', userId);
      const t = now();
      if (u.pin_locked_until > t) return { locked: true, retryAfterMs: u.pin_locked_until - t };
      if (verifySecret(pin, u.pin_hash)) {
        if (u.pin_fails) run('UPDATE users SET pin_fails = 0 WHERE id = ?', userId);
        return { ok: true };
      }
      const fails = u.pin_fails + 1;
      if (fails >= cfg.pinMaxFails) {
        run('UPDATE users SET pin_fails = 0, pin_locked_until = ? WHERE id = ?', t + cfg.pinLockMs, userId);
        audit(userId, 'pin_locked');
        return { locked: true, retryAfterMs: cfg.pinLockMs };
      }
      run('UPDATE users SET pin_fails = ? WHERE id = ?', fails, userId);
      return { wrong: true, triesLeft: cfg.pinMaxFails - fails };
    });
    if (outcome.locked) throw new AppError(423, 'PIN_LOCKED', 'Too many wrong PINs. Try again later.', { retryAfterMs: outcome.retryAfterMs });
    if (outcome.wrong) throw new AppError(401, 'WRONG_PIN', 'Wrong PIN', { triesLeft: outcome.triesLeft });
    return { ok: true };
  }

  function changePin(userId, oldPin, newPin) {
    verifyPin(userId, oldPin);
    run('UPDATE users SET pin_hash = ? WHERE id = ?', hashSecret(newPin), userId);
    audit(userId, 'pin_changed');
  }

  /* ---------- payments ---------- */
  function startOfDay() {
    const off = cfg.tzOffsetMin * 60000;
    return Math.floor((now() + off) / 86400000) * 86400000 - off;
  }
  function netOut(t) { return t.amount - t.rev_recovered; }
  function spentToday(userId) {
    return all('SELECT amount, rev_recovered FROM transactions WHERE payer_user = ? AND created_at >= ?', userId, startOfDay()).reduce((a, t) => a + netOut(t), 0);
  }
  function undoUsed(userId) {
    return one('SELECT COUNT(*) c FROM undo_log WHERE user_id = ? AND created_at >= ?', userId, now() - cfg.abuseWindowMs).c;
  }

  // Runs inside a transaction opened by the caller (pay or approveCollect).
  function payInner({ userId, to, amount, note, accountId, idemKey, saveContact, viaCollect }) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError(400, 'BAD_AMOUNT', 'Enter a valid amount');
    note = String(note || '').slice(0, 50);
    if (idemKey) {
      const ex = one('SELECT * FROM transactions WHERE payer_user = ? AND idem_key = ?', userId, idemKey);
      if (ex) return { txn: ex, replay: true };
    }
    const from = one('SELECT * FROM accounts WHERE id = ? AND user_id = ?', accountId, userId);
    if (!from) throw new AppError(404, 'NO_ACCOUNT', 'Choose a linked bank account');
    const party = findParty(userId, to);
    if (amount > cfg.txnLimit) throw new AppError(422, 'LIMIT', `Per-payment limit is ${rs(cfg.txnLimit)}`);
    if (!party.saved && amount > cfg.newPayeeLimit) throw new AppError(422, 'NEW_PAYEE_LIMIT', `New payees are limited to ${rs(cfg.newPayeeLimit)} per payment. Save them as a contact for higher amounts.`);
    if (spentToday(userId) + amount > cfg.dailyLimit) throw new AppError(422, 'DAILY_LIMIT', `This would pass your daily limit of ${rs(cfg.dailyLimit)}`);
    if (from.balance < amount) throw new AppError(409, 'INSUFFICIENT_FUNDS', `Not enough balance in ${from.bank_name}`);
    const payer = one('SELECT name, vpa FROM users WHERE id = ?', userId);
    const id = run(
      `INSERT INTO transactions(ref,rrn,idem_key,payer_user,payer_name,payer_vpa,from_account,to_account,to_user,payee_name,payee_vpa,amount,note,status,new_payee,via_collect,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'SUCCESS',?,?,?)`,
      newRef(), rrn(), idemKey || null, userId, payer.name, payer.vpa, from.id, party.account.id, party.toUser,
      party.name, party.vpa, amount, note, party.saved ? 0 : 1, viaCollect ? 1 : 0, now()
    ).lastInsertRowid;
    debit(from.id, amount, id, 'debit');
    credit(party.account.id, amount, id, 'credit');
    if (saveContact && !party.saved) {
      run('INSERT INTO contacts(user_id,name,vpa,mobile,type,created_at) VALUES(?,?,?,?,?,?)', userId, party.verifiedName, party.vpa, party.mobile || '', 'person', now());
    }
    audit(userId, viaCollect ? 'pay_collect' : 'pay', { ref: id, amount, to: party.vpa });
    return { txn: one('SELECT * FROM transactions WHERE id = ?', id), replay: false };
  }
  function pay(args) {
    if (!Number.isSafeInteger(args.amount) || args.amount <= 0) throw new AppError(400, 'BAD_AMOUNT', 'Enter a valid amount');
    return tx(() => payInner(args));
  }

  /* ---------- collect ("pay me") requests ---------- */
  // These are the heart of the UPI scam: a stranger sends a request and says you will RECEIVE money.
  // Approving it with your PIN actually PAYS them. Approval therefore needs an explicit acknowledgement.

  function riskFlags(r, saved, reports) {
    const flags = [];
    if (!saved) flags.push('not_in_contacts');
    if (reports > 0) flags.push('reported');
    if (SCAM_WORDS.test(r.note || '')) flags.push('scam_words');
    if (r.amount >= cfg.newPayeeLimit) flags.push('large_amount');
    return flags;
  }

  function createRequest(userId, to, amount, note) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError(400, 'BAD_AMOUNT', 'Enter a valid amount');
    const p = findParty(userId, to);
    const me = one('SELECT name, vpa FROM users WHERE id = ?', userId);
    const t = now();
    run(
      `INSERT INTO collect_requests(requester_user,requester_name,requester_vpa,payer_user,payer_name,payer_vpa,amount,note,created_at,expires_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      userId, me.name, me.vpa, p.toUser, p.name, p.vpa, amount, String(note || '').slice(0, 50), t, t + cfg.collectTtlMs
    );
    audit(userId, 'collect_request', { to: p.vpa, amount });
  }

  function approveCollect({ userId, id, accountId, ack, idemKey }) {
    if (ack !== true) throw new AppError(400, 'ACK_REQUIRED', 'Confirm that you understand this request takes money out of your account.');
    return tx(() => {
      const r = one('SELECT * FROM collect_requests WHERE id = ? AND payer_user = ?', id, userId);
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found');
      if (r.status !== 'PENDING') throw new AppError(409, 'ALREADY_HANDLED', 'This request has already been handled');
      if (r.expires_at <= now()) {
        run("UPDATE collect_requests SET status = 'EXPIRED' WHERE id = ?", r.id);
        return { expired: true };
      }
      const res = payInner({ userId, to: r.requester_vpa, amount: r.amount, note: r.note ? r.note : 'Payment request', accountId, idemKey, saveContact: false, viaCollect: true });
      run("UPDATE collect_requests SET status = 'PAID', txn_id = ? WHERE id = ?", res.txn.id, r.id);
      return res;
    });
  }

  function declineCollect({ userId, id, report }) {
    return tx(() => {
      const r = one('SELECT * FROM collect_requests WHERE id = ? AND payer_user = ?', id, userId);
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found');
      if (r.status !== 'PENDING') throw new AppError(409, 'ALREADY_HANDLED', 'This request has already been handled');
      run("UPDATE collect_requests SET status = 'DECLINED', reported = ? WHERE id = ?", report ? 1 : 0, r.id);
      audit(userId, report ? 'collect_reported' : 'collect_declined', { id: r.id, from: r.requester_vpa });
    });
  }

  /* ---------- undo / dispute ---------- */
  function openDispute(txn, userId, reason, review) {
    const ticket = (review ? 'REV' : 'DSP') + String(crypto.randomInt(1e6, 1e7));
    run("UPDATE transactions SET status = 'DISPUTED' WHERE id = ?", txn.id);
    run('INSERT INTO disputes(ticket,txn_id,user_id,reason,review,created_at) VALUES(?,?,?,?,?,?)', ticket, txn.id, userId, reason, review ? 1 : 0, now());
    audit(userId, review ? 'undo_to_review' : 'dispute', { ref: txn.ref, reason });
    return ticket;
  }

  // mode 'undo' reverses instantly while the window is open. After the window (or when the user
  // already used all their undos) it opens a dispute instead. mode 'dispute' always opens a dispute.
  function undo({ userId, ref, reason, mode }) {
    if (!REASONS.includes(reason)) throw new AppError(400, 'BAD_REASON', 'Choose a reason');
    return tx(() => {
      const t = one('SELECT * FROM transactions WHERE ref = ? AND payer_user = ?', ref, userId);
      if (!t) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
      if (t.status !== 'SUCCESS') throw new AppError(409, 'NOT_UNDOABLE', 'This payment has already been reversed or reported');
      const within = now() < t.created_at + cfg.undoWindowMs;
      if (mode === 'dispute' || !within) {
        const ticket = openDispute(t, userId, reason, false);
        return { mode: 'dispute', ticket, txn: one('SELECT * FROM transactions WHERE id = ?', t.id) };
      }
      if (undoUsed(userId) >= cfg.abuseLimit) {
        const ticket = openDispute(t, userId, reason, true);
        return { mode: 'review', ticket, txn: one('SELECT * FROM transactions WHERE id = ?', t.id) };
      }
      const to = one('SELECT * FROM accounts WHERE id = ?', t.to_account);
      const recovered = Math.min(to.balance, t.amount);
      if (recovered > 0) {
        debit(to.id, recovered, t.id, 'reversal_debit');
        creditRaw(t.from_account, recovered, t.id, 'reversal_credit');
      }
      const lien = t.amount - recovered;
      if (lien > 0) {
        run('INSERT INTO liens(txn_id,account_id,claimant_account,original,amount,created_at) VALUES(?,?,?,?,?,?)', t.id, to.id, t.from_account, lien, lien, now());
      }
      run(
        'UPDATE transactions SET status = ?, rev_rrn = ?, rev_reason = ?, rev_recovered = ?, rev_lien = ?, rev_at = ? WHERE id = ?',
        lien > 0 ? 'PARTIAL' : 'REVERSED', rrn(), reason, recovered, lien, now(), t.id
      );
      run('INSERT INTO undo_log(user_id,txn_id,reason,created_at) VALUES(?,?,?,?)', userId, t.id, reason, now());
      audit(userId, 'undo', { ref, reason, recovered, lien });
      return { mode: lien > 0 ? 'partial' : 'full', txn: one('SELECT * FROM transactions WHERE id = ?', t.id) };
    });
  }

  /* ---------- reads ---------- */
  function balance(userId, accountId) {
    const a = one('SELECT balance, bank_name, last4 FROM accounts WHERE id = ? AND user_id = ?', accountId, userId);
    if (!a) throw new AppError(404, 'NO_ACCOUNT', 'Account not found');
    return a;
  }

  function viewTxn(t, userId, banks) {
    const out = t.payer_user === userId;
    const within = now() < t.created_at + cfg.undoWindowMs;
    const v = {
      id: t.ref, rrn: t.rrn, dir: out ? 'out' : 'in', amount: t.amount, note: t.note, ts: t.created_at,
      party: out ? { name: t.payee_name, vpa: t.payee_vpa } : { name: t.payer_name, vpa: t.payer_vpa },
      status: t.status, newPayee: !!t.new_payee, viaCollect: !!t.via_collect,
    };
    if (out) {
      v.bankId = t.from_account;
      v.bankLabel = banks[t.from_account] || '';
      v.canUndo = t.status === 'SUCCESS' && within;
      v.undoUntil = t.created_at + cfg.undoWindowMs;
      v.canDispute = t.status === 'SUCCESS' && !within;
      if (t.rev_at) v.reversal = { ts: t.rev_at, rrn: t.rev_rrn, reason: t.rev_reason, recovered: t.rev_recovered, lien: t.rev_lien };
      if (t.status === 'DISPUTED') {
        const d = one('SELECT ticket, review, created_at FROM disputes WHERE txn_id = ? ORDER BY id DESC LIMIT 1', t.id);
        if (d) v.dispute = { ticket: d.ticket, review: !!d.review, ts: d.created_at };
      }
    } else if (t.status === 'REVERSED' || t.status === 'PARTIAL') {
      v.reversedBySender = true; // recipients see that it was reversed, not why
    }
    return v;
  }

  function getState(userId) {
    const u = one('SELECT id, name, vpa, mobile FROM users WHERE id = ?', userId);
    const accounts = all('SELECT id, bank_name, last4, is_primary FROM accounts WHERE user_id = ? ORDER BY is_primary DESC, id', userId);
    const banks = {};
    accounts.forEach((a) => { banks[a.id] = `${a.bank_name} ••${a.last4}`; });
    const contacts = all('SELECT * FROM contacts WHERE user_id = ? ORDER BY name', userId).map((c) => {
      const acc = one('SELECT id FROM accounts WHERE (user_id IS NULL AND vpa = ?) OR user_id = (SELECT id FROM users WHERE vpa = ?) AND is_primary = 1', c.vpa.toLowerCase(), c.vpa.toLowerCase());
      return { id: c.id, name: c.name, vpa: c.vpa, mobile: c.mobile, type: c.type, reports: acc ? reportsAgainst(acc.id) : 0 };
    });
    const txns = all('SELECT * FROM transactions WHERE payer_user = ? OR to_user = ? ORDER BY created_at DESC, id DESC LIMIT 200', userId, userId).map((t) => viewTxn(t, userId, banks));
    run("UPDATE collect_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= ?", now());
    const requests = all('SELECT id, payer_name AS name, payer_vpa AS vpa, amount, note, status, created_at, payer_user IS NULL AS external FROM collect_requests WHERE requester_user = ? ORDER BY id DESC LIMIT 50', userId)
      .map((r) => ({ ...r, external: !!r.external }));
    const incoming = all("SELECT * FROM collect_requests WHERE payer_user = ? AND status = 'PENDING' ORDER BY id DESC", userId).map((r) => {
      const saved = !!one('SELECT 1 x FROM contacts WHERE user_id = ? AND lower(vpa) = ?', userId, r.requester_vpa.toLowerCase());
      const acc = one('SELECT id FROM accounts WHERE (user_id IS NULL AND vpa = ?) OR (user_id = (SELECT id FROM users WHERE vpa = ?) AND is_primary = 1)', r.requester_vpa, r.requester_vpa);
      const reports = acc ? reportsAgainst(acc.id) : 0;
      return { id: r.id, name: r.requester_name, vpa: r.requester_vpa, amount: r.amount, note: r.note, ts: r.created_at, expiresAt: r.expires_at, saved, reports, registered: r.requester_user != null, risk: riskFlags(r, saved, reports) };
    });
    return {
      me: { name: u.name, vpa: u.vpa, mobile: u.mobile },
      banks: accounts.map((a) => ({ id: a.id, name: a.bank_name, last4: a.last4, primary: !!a.is_primary })),
      contacts, txns, requests, incoming,
      policy: {
        sandbox: cfg.sandbox, undoWindowMs: cfg.undoWindowMs, abuseLimit: cfg.abuseLimit, abuseDays: cfg.abuseWindowMs / 86400000,
        txnLimit: cfg.txnLimit, dailyLimit: cfg.dailyLimit, newPayeeLimit: cfg.newPayeeLimit,
      },
      stats: { undoUsed: undoUsed(userId), spentToday: spentToday(userId) },
      serverTime: now(),
    };
  }

  function addContact(userId, input, type) {
    const p = findParty(userId, input);
    if (p.saved) throw new AppError(409, 'DUPLICATE', `Already in your contacts as ${p.name}`);
    run('INSERT INTO contacts(user_id,name,vpa,mobile,type,created_at) VALUES(?,?,?,?,?,?)', userId, p.verifiedName, p.vpa, p.mobile || '', type === 'merchant' ? 'merchant' : 'person', now());
    return { name: p.verifiedName, vpa: p.vpa };
  }

  function setPrimary(userId, accountId) {
    return tx(() => {
      if (!one('SELECT 1 x FROM accounts WHERE id = ? AND user_id = ?', accountId, userId)) throw new AppError(404, 'NO_ACCOUNT', 'Account not found');
      run('UPDATE accounts SET is_primary = 0 WHERE user_id = ?', userId);
      run('UPDATE accounts SET is_primary = 1 WHERE id = ?', accountId);
    });
  }

  /* ---------- sandbox helpers (disabled when cfg.sandbox is false) ---------- */
  function needSandbox() { if (!cfg.sandbox) throw new AppError(404, 'NOT_FOUND', 'Not found'); }

  function sandboxAddMoney(userId, amount) {
    needSandbox();
    return tx(() => {
      const a = one('SELECT id FROM accounts WHERE user_id = ? AND is_primary = 1', userId);
      creditRaw(a.id, amount, null, 'sandbox_fund');
    });
  }

  // Simulates the recipient spending most of a payment, so the next undo is partial.
  function sandboxSpend(userId, ref) {
    needSandbox();
    return tx(() => {
      const t = one('SELECT * FROM transactions WHERE ref = ? AND payer_user = ? AND status = ?', ref, userId, 'SUCCESS');
      if (!t) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
      const acc = one('SELECT * FROM accounts WHERE id = ?', t.to_account);
      const keep = Math.floor(t.amount * 0.2);
      const take = Math.max(0, acc.balance - keep);
      if (take > 0) debit(acc.id, take, null, 'sandbox_spend');
      return { kept: Math.min(acc.balance, keep) };
    });
  }

  function sandboxRequestPaid(userId, requestId) {
    needSandbox();
    return tx(() => {
      const r = one("SELECT * FROM collect_requests WHERE id = ? AND requester_user = ? AND status = 'PENDING'", requestId, userId);
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Request not found');
      if (r.payer_user != null) throw new AppError(409, 'REGISTERED_PAYER', 'This person has an ARMAPay account. They approve the request in their own app.');
      let ext = one('SELECT * FROM accounts WHERE user_id IS NULL AND vpa = ?', r.payer_vpa);
      if (!ext) ext = createExternal(r.payer_vpa, r.payer_name);
      if (ext.balance < r.amount) creditRaw(ext.id, r.amount - ext.balance, null, 'sandbox_fund');
      const me = one('SELECT * FROM users WHERE id = ?', userId);
      const dest = one('SELECT id FROM accounts WHERE user_id = ? AND is_primary = 1', userId);
      const id = run(
        `INSERT INTO transactions(ref,rrn,payer_user,payer_name,payer_vpa,from_account,to_account,to_user,payee_name,payee_vpa,amount,note,status,new_payee,via_collect,created_at)
         VALUES(?,?,NULL,?,?,?,?,?,?,?,?,?,'SUCCESS',0,1,?)`,
        newRef(), rrn(), r.payer_name, r.payer_vpa, ext.id, dest.id, userId, me.name, me.vpa, r.amount, r.note || 'Requested payment', now()
      ).lastInsertRowid;
      debit(ext.id, r.amount, id, 'debit');
      credit(dest.id, r.amount, id, 'credit');
      run("UPDATE collect_requests SET status = 'PAID', txn_id = ? WHERE id = ?", id, r.id);
    });
  }

  // Simulates an outside UPI ID asking this user to pay. 'scam' imitates the classic
  // "you will receive a refund, approve to get it" request; 'contact' is an ordinary bill from a saved contact.
  function sandboxIncomingCollect(userId, kind) {
    needSandbox();
    return tx(() => {
      const spec = kind === 'contact'
        ? { name: 'Green Roots Organic Farm', vpa: 'greenroots@okhdfc', amount: 2340 * 100, note: 'Invoice 118' }
        : { name: 'Quick Refund Support', vpa: 'refund.support@okpay', amount: 4999 * 100, note: 'Refund pending. Approve to receive' };
      const me = one('SELECT name, vpa FROM users WHERE id = ?', userId);
      if (!one('SELECT 1 x FROM accounts WHERE user_id IS NULL AND vpa = ?', spec.vpa)) createExternal(spec.vpa, spec.name);
      const t = now();
      run(
        `INSERT INTO collect_requests(requester_user,requester_name,requester_vpa,payer_user,payer_name,payer_vpa,amount,note,created_at,expires_at)
         VALUES(NULL,?,?,?,?,?,?,?,?,?)`,
        spec.name, spec.vpa, userId, me.name, me.vpa, spec.amount, spec.note, t, t + cfg.collectTtlMs
      );
    });
  }

  // Sanity check used by tests and by an optional nightly job: every balance must equal its ledger entries.
  function checkInvariants() {
    return all(
      `SELECT a.id, a.balance, COALESCE(SUM(e.delta),0) AS total FROM accounts a
       LEFT JOIN ledger_entries e ON e.account_id = a.id GROUP BY a.id HAVING a.balance != total`
    );
  }

  return {
    createUser, verifyPin, changePin, resolve, pay, undo, balance, getState, addContact, setPrimary,
    createRequest, approveCollect, declineCollect, sandboxAddMoney, sandboxSpend, sandboxRequestPaid, sandboxIncomingCollect,
    checkInvariants, audit, run, one, all, createExternal,
  };
}

module.exports = { createLedger, AppError, REASONS, SCAM_WORDS };
