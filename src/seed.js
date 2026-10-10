'use strict';
// Creates two demo users so you can test a real two-sided payment and undo:
//   Afsar  9876500001 / password "armapay-demo" / PIN 1234
//   Kavya  9876500002 / password "armapay-demo" / PIN 1234
const cfg = require('./config');
const { openDb } = require('./db');
const { createLedger } = require('./ledger');
const sec = require('./security');

if (!cfg.sandbox) { console.error('Refusing to seed demo users when SANDBOX=0'); process.exit(1); }
const db = openDb(cfg.dbFile);
const ledger = createLedger(db, cfg);
for (const u of [
  { name: 'Afsar', mobile: '9876500001', handle: 'afsar' },
  { name: 'Kavya Nair', mobile: '9876500002', handle: 'kavya' },
]) {
  try {
    ledger.createUser({ ...u, passwordHash: sec.hashSecret('armapay-demo'), pinHash: sec.hashSecret('1234') });
    console.log(`created ${u.name} (${u.mobile})`);
  } catch (e) { console.log(`skipped ${u.name}: ${e.message}`); }
}
db.close();
