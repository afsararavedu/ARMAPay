'use strict';
// Consistent copy of the live database (safe while the app is running). Usage: node scripts/backup.js [folder]
// Default folder: <database folder>/backups. Keeps the newest 14 copies.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openSqlite } = require('../src/sqlite');

const dbFile = path.resolve(process.env.DB_FILE || path.join(os.homedir(), 'armapay-data', 'armapay.db'));
if (!fs.existsSync(dbFile)) { console.error('Database not found: ' + dbFile + '\nSet DB_FILE to its path.'); process.exit(1); }
const dir = path.resolve(process.argv[2] || path.join(path.dirname(dbFile), 'backups'));
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'armapay-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');

const db = openSqlite(dbFile);
db.pragma('busy_timeout = 5000');
db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'");
db.close();
console.log('Backup written: ' + out);

const old = fs.readdirSync(dir).filter((f) => /^armapay-.*\.db$/.test(f)).sort().slice(0, -14);
for (const f of old) fs.unlinkSync(path.join(dir, f));
