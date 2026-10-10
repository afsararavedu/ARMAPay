'use strict';
// Entry file for hosted deployments (Hostinger Node.js Web Apps and similar).
//
// Differences from `npm run dev` / src/server.js:
//   - listens on every interface and on PORT (3000 if the host does not say), because the host's proxy connects from outside;
//   - keeps the database OUTSIDE the app folder. Hostinger replaces the whole app folder on every deployment,
//     so a database inside it would be wiped by the next deploy.
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.PORT = process.env.PORT || '3000';
if (!process.env.DB_FILE) process.env.DB_FILE = path.join(os.homedir(), 'armapay-data', 'armapay.db');

const dbFile = path.resolve(process.env.DB_FILE);
if (dbFile.startsWith(__dirname + path.sep)) {
  console.warn('WARNING: DB_FILE is inside the app folder (' + dbFile + '). A redeploy will delete the database. Point DB_FILE at a folder outside the app, for example ~/armapay-data/armapay.db');
}
try {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.accessSync(path.dirname(dbFile), fs.constants.W_OK);
} catch (e) {
  console.error('Cannot write to the database folder ' + path.dirname(dbFile) + ': ' + e.message + '\nSet the DB_FILE environment variable to a writable path outside the app folder.');
  process.exit(1);
}

require('./src/server').start();
