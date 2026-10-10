'use strict';
// One tiny SQLite surface for the whole app: prepare().get/all/run, exec, pragma, transaction().immediate(), close.
//
// Preferred driver: better-sqlite3 (fast, native). It is an *optional* dependency, because some shared hosts cannot
// compile or download native modules during the build. When it is missing, this falls back to the SQLite that ships
// inside Node itself (node:sqlite, Node 22.5 or newer), which needs no install step at all.
// Force one with SQLITE_DRIVER=better-sqlite3 or SQLITE_DRIVER=node.

function wantNative() {
  const pick = (process.env.SQLITE_DRIVER || '').toLowerCase();
  if (pick === 'node' || pick === 'node:sqlite') return false;
  try {
    return require('better-sqlite3');
  } catch (e) {
    if (pick === 'better-sqlite3') throw e;
    return false;
  }
}

// node:sqlite reports constraint failures as ERR_SQLITE_ERROR plus a numeric errcode. Present them the way
// better-sqlite3 does (SQLITE_CONSTRAINT_*) so the rest of the app has one thing to check.
function normalise(e) {
  if (e && typeof e.errcode === 'number' && (e.errcode & 0xff) === 19) {
    const names = { 275: 'CHECK', 531: 'COMMITHOOK', 787: 'FOREIGNKEY', 1043: 'FUNCTION', 1299: 'NOTNULL', 1555: 'PRIMARYKEY', 1811: 'TRIGGER', 2067: 'UNIQUE', 2323: 'VTAB', 2579: 'ROWID' };
    e.code = 'SQLITE_CONSTRAINT' + (names[e.errcode] ? '_' + names[e.errcode] : '');
  }
  return e;
}

function wrapStatement(st) {
  const call = (fn) => (...args) => { try { return fn.apply(st, args); } catch (e) { throw normalise(e); } };
  return { get: call(st.get), all: call(st.all), run: call(st.run) };
}

class NodeSqlite {
  constructor(file) {
    const { DatabaseSync } = require('node:sqlite');
    this.raw = new DatabaseSync(file);
    this.depth = 0;
    this.driver = 'node:sqlite';
  }
  prepare(sql) { try { return wrapStatement(this.raw.prepare(sql)); } catch (e) { throw normalise(e); } }
  exec(sql) { try { return this.raw.exec(sql); } catch (e) { throw normalise(e); } }
  pragma(text) { return this.prepare('PRAGMA ' + text).all(); }
  close() { this.raw.close(); }
  // Mirrors better-sqlite3: db.transaction(fn)(...) or .immediate(...). Nested calls become savepoints.
  transaction(fn) {
    const make = (mode) => (...args) => {
      const nested = this.depth > 0;
      const sp = 'sp' + this.depth;
      this.exec(nested ? 'SAVEPOINT ' + sp : 'BEGIN ' + mode);
      this.depth++;
      try {
        const out = fn(...args);
        this.exec(nested ? 'RELEASE ' + sp : 'COMMIT');
        return out;
      } catch (e) {
        try {
          this.exec(nested ? 'ROLLBACK TO ' + sp : 'ROLLBACK');
          if (nested) this.exec('RELEASE ' + sp);
        } catch (_) { /* SQLite had already rolled back */ }
        throw e;
      } finally {
        this.depth--;
      }
    };
    const f = make('DEFERRED');
    f.deferred = f;
    f.immediate = make('IMMEDIATE');
    f.exclusive = make('EXCLUSIVE');
    return f;
  }
}

function openSqlite(file) {
  const Native = wantNative();
  if (Native) { const db = new Native(file); db.driver = 'better-sqlite3'; return db; }
  try {
    return new NodeSqlite(file);
  } catch (e) {
    throw new Error('No SQLite driver available. Install better-sqlite3 (npm install) or use Node 22.5 or newer, which has SQLite built in. Cause: ' + e.message);
  }
}

module.exports = { openSqlite };
