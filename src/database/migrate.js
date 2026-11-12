/**
 * Database Migration Runner for Supabase PostgreSQL
 * Executes forward-only SQL migration scripts in order ONLY after verifying
 * strict isolation with GUeAttend project reference `cnpullmxupyqdndxzbih`.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { assertDatabaseIsolation, resolvePgSslConfig } = require('./identity');

async function runMigrations() {
  console.log('[migrate] Initializing GUeAttend database isolation check...');

  // Abort immediately if DATABASE_URL / SUPABASE_URL do not match GUeAttend (cnpullmxupyqdndxzbih)
  const report = assertDatabaseIsolation();
  console.log(`[migrate] Isolation verified for Supabase project: ${report.expectedRef} (host=${report.dbHost})`);

  const DATABASE_URL = process.env.DATABASE_URL || '';
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: resolvePgSslConfig(DATABASE_URL),
  });

  const client = await pool.connect();

  try {
    // 1. Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Read all .sql files in migrations dir in lexical order
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    // 3. Check already applied migrations
    const res = await client.query('SELECT id FROM schema_migrations');
    const applied = new Set(res.rows.map((r) => r.id));

    console.log(`[migrate] Found ${files.length} migration files (${applied.size} already applied).`);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] Skipping already applied: ${file}`);
        continue;
      }

      console.log(`[migrate] Applying migration: ${file}...`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] ✓ Successfully applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] ✗ Failed to apply ${file}:`, err.message);
        throw err;
      }
    }

    console.log('[migrate] ✓ All database migrations completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('[migrate] ABORTED:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigrations };
