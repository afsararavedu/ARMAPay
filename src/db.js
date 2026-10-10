'use strict';
const fs = require('fs');
const path = require('path');
const { openSqlite } = require('./sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  mobile TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  vpa TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_fails INTEGER NOT NULL DEFAULT 0,
  pin_locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- A bank account linked to a user (user_id set) or a simulated external UPI ID (user_id NULL, vpa set).
-- The CHECK makes an overdraft impossible even if application code has a bug.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  vpa TEXT,
  display_name TEXT,
  bank_name TEXT NOT NULL,
  last4 TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_external_vpa ON accounts(vpa) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  vpa TEXT NOT NULL,
  mobile TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'person' CHECK (type IN ('person','merchant')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, vpa)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  rrn TEXT NOT NULL UNIQUE,
  idem_key TEXT,
  payer_user INTEGER REFERENCES users(id),
  payer_name TEXT NOT NULL,
  payer_vpa TEXT NOT NULL,
  from_account INTEGER NOT NULL REFERENCES accounts(id),
  to_account INTEGER NOT NULL REFERENCES accounts(id),
  to_user INTEGER REFERENCES users(id),
  payee_name TEXT NOT NULL,
  payee_vpa TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('SUCCESS','REVERSED','PARTIAL','DISPUTED')),
  new_payee INTEGER NOT NULL DEFAULT 0,
  via_collect INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  rev_rrn TEXT,
  rev_reason TEXT,
  rev_recovered INTEGER NOT NULL DEFAULT 0,
  rev_lien INTEGER NOT NULL DEFAULT 0,
  rev_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS txn_idem ON transactions(payer_user, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS txn_payer ON transactions(payer_user, created_at);
CREATE INDEX IF NOT EXISTS txn_to_user ON transactions(to_user, created_at);
CREATE INDEX IF NOT EXISTS txn_to_account ON transactions(to_account);

-- Every balance change is mirrored here, so SUM(delta) per account must equal its balance.
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY,
  txn_id INTEGER REFERENCES transactions(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_account ON ledger_entries(account_id);

-- Money that could not be recovered during an undo. Captured from the next credits to that account.
CREATE TABLE IF NOT EXISTS liens (
  id INTEGER PRIMARY KEY,
  txn_id INTEGER NOT NULL REFERENCES transactions(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  claimant_account INTEGER NOT NULL REFERENCES accounts(id),
  original INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS liens_open ON liens(account_id, status);

CREATE TABLE IF NOT EXISTS undo_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  txn_id INTEGER NOT NULL REFERENCES transactions(id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS undo_user ON undo_log(user_id, created_at);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY,
  ticket TEXT NOT NULL UNIQUE,
  txn_id INTEGER NOT NULL REFERENCES transactions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  review INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at INTEGER NOT NULL
);

-- A "collect" request: the requester asks the payer to PAY them. Approving it takes money out of the payer's account.
-- requester_user is NULL for a request from an outside UPI ID. payer_user is NULL when the payer is not an ARMAPay user.
CREATE TABLE IF NOT EXISTS collect_requests (
  id INTEGER PRIMARY KEY,
  requester_user INTEGER REFERENCES users(id),
  requester_name TEXT NOT NULL,
  requester_vpa TEXT NOT NULL,
  payer_user INTEGER REFERENCES users(id),
  payer_name TEXT NOT NULL,
  payer_vpa TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','DECLINED','EXPIRED')),
  reported INTEGER NOT NULL DEFAULT 0,
  txn_id INTEGER REFERENCES transactions(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS collect_payer ON collect_requests(payer_user, status);
CREATE INDEX IF NOT EXISTS collect_requester ON collect_requests(requester_user, created_at);
CREATE INDEX IF NOT EXISTS collect_reports ON collect_requests(requester_vpa, reported);

-- One-time passwords for password reset. Only a salted hash of the code is stored.
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mobile TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'reset',
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_user ON otp_codes(user_id, id);

-- Every QR check is recorded. This is the QR's history. user_id is NULL only for sandbox demo history.
CREATE TABLE IF NOT EXISTS qr_checks (
  id INTEGER PRIMARY KEY,
  check_id TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vpa TEXT NOT NULL,
  fp TEXT NOT NULL,
  amount INTEGER,
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS qr_checks_vpa ON qr_checks(vpa, created_at);
CREATE INDEX IF NOT EXISTS qr_checks_fp ON qr_checks(fp);

-- User reports against a QR / payee. reporter_user is NULL only for sandbox demo reports.
CREATE TABLE IF NOT EXISTS qr_reports (
  id INTEGER PRIMARY KEY,
  reporter_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vpa TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('fraud','scam','cheating','other')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS qr_reports_vpa ON qr_reports(vpa, created_at);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = openSqlite(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  // Databases created by an earlier build lack the via_collect column.
  const cols = db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
  if (!cols.includes('via_collect')) db.exec('ALTER TABLE transactions ADD COLUMN via_collect INTEGER NOT NULL DEFAULT 0');
  return db;
}

module.exports = { openDb };
