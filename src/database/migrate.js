/**
 * Database Migration Runner for Supabase PostgreSQL
 * Executes SQL migration scripts in order and tracks applied migrations.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || '';

async function runMigrations() {
  console.log('[migrate] Initializing database migrations...');

  if (!DATABASE_URL) {
    console.error('[migrate] ERROR: DATABASE_URL environment variable is not set.');
    console.error('[migrate] Please configure DATABASE_URL in your .env file or environment.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
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

    // 2. Read all .sql files in migrations dir
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
    console.error('[migrate] Fatal migration error:', err.message);
    process.exit(1);
  });
}

module.exports = { runMigrations };

