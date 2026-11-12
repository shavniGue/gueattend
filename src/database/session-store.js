/**
 * PostgreSQL-Backed Express Session Store (`http_sessions`)
 * Ensures user sessions survive Render container restarts without relying on local disk.
 * Falls back gracefully to in-memory session storage only when PostgreSQL pool is unavailable.
 */

const session = require('express-session');

class PostgresSessionStore extends session.Store {
  constructor({ db, ttlSeconds = 90 * 24 * 60 * 60, tableName = 'http_sessions' } = {}) {
    super();
    if (!/^[a-z_][a-z0-9_]*$/i.test(tableName)) {
      throw new Error(`Invalid session store table name: ${tableName}`);
    }
    this.db = db;
    this.ttlSeconds = ttlSeconds;
    this.tableName = tableName;
    this.memoryFallback = new Map();
    this.tableVerified = false;
    this.ensurePromise = null;
    this.pruneTimer = setInterval(() => {
      this.pruneExpired().catch((err) => {
        console.warn('[session-store] Prune warning:', err.code || err.message);
      });
    }, 15 * 60 * 1000);
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  async ensureTable() {
    if (this.tableVerified || !this.db?.pool) return;
    if (this.ensurePromise) return this.ensurePromise;

    this.ensurePromise = (async () => {
      try {
        await this.db.query(`
          CREATE TABLE IF NOT EXISTS ${this.tableName} (
            sid TEXT PRIMARY KEY,
            sess JSONB NOT NULL,
            expire TIMESTAMPTZ NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expire ON ${this.tableName} (expire);
        `);
        this.tableVerified = true;
      } catch (err) {
        this.ensurePromise = null;
        console.error('[session-store] Failed to initialize PostgreSQL session table:', err.code || err.message);
        throw err;
      }
    })();

    return this.ensurePromise;
  }

  computeExpiryDate(sess) {
    const maxAge = sess?.cookie?.originalMaxAge;
    if (typeof maxAge === 'number' && maxAge > 0) {
      return new Date(Date.now() + maxAge);
    }
    return new Date(Date.now() + this.ttlSeconds * 1000);
  }

  get(sid, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    if (!this.db?.pool) {
      const item = this.memoryFallback.get(sid);
      if (!item || item.expire <= Date.now()) {
        this.memoryFallback.delete(sid);
        return done(null, null);
      }
      return done(null, item.sess);
    }

    (async () => {
      await this.ensureTable();
      const res = await this.db.query(
        `SELECT sess FROM ${this.tableName} WHERE sid = $1 AND expire > NOW() LIMIT 1`,
        [sid]
      );
      if (res.rows.length === 0) return done(null, null);
      const sessData = typeof res.rows[0].sess === 'string'
        ? JSON.parse(res.rows[0].sess)
        : res.rows[0].sess;
      return done(null, sessData);
    })().catch((err) => done(err));
  }

  set(sid, sess, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    const expireDate = this.computeExpiryDate(sess);
    if (!this.db?.pool) {
      this.memoryFallback.set(sid, { sess, expire: expireDate.getTime() });
      return done(null);
    }

    (async () => {
      await this.ensureTable();
      await this.db.query(
        `INSERT INTO ${this.tableName} (sid, sess, expire)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (sid) DO UPDATE SET
           sess = EXCLUDED.sess,
           expire = EXCLUDED.expire`,
        [sid, JSON.stringify(sess), expireDate]
      );
      return done(null);
    })().catch((err) => done(err));
  }

  destroy(sid, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    this.memoryFallback.delete(sid);
    if (!this.db?.pool) {
      return done(null);
    }

    (async () => {
      await this.ensureTable();
      await this.db.query(`DELETE FROM ${this.tableName} WHERE sid = $1`, [sid]);
      return done(null);
    })().catch((err) => done(err));
  }

  touch(sid, sess, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    const expireDate = this.computeExpiryDate(sess);
    if (!this.db?.pool) {
      const existing = this.memoryFallback.get(sid);
      if (existing) existing.expire = expireDate.getTime();
      return done(null);
    }

    (async () => {
      await this.ensureTable();
      await this.db.query(
        `UPDATE ${this.tableName} SET expire = $2 WHERE sid = $1`,
        [sid, expireDate]
      );
      return done(null);
    })().catch((err) => done(err));
  }

  async pruneExpired() {
    const now = Date.now();
    for (const [k, v] of this.memoryFallback.entries()) {
      if (v.expire <= now) this.memoryFallback.delete(k);
    }
    if (!this.db?.pool) return;
    await this.ensureTable();
    await this.db.query(`DELETE FROM ${this.tableName} WHERE expire <= NOW()`);
  }
}

module.exports = { PostgresSessionStore };
