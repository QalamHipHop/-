#!/usr/bin/env node
/**
 * Minimal forward-only migrator.
 *   node database/postgres/migrate.js up
 *   node database/postgres/migrate.js down 1
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function main() {
  const cmd = process.argv[2] || 'up';
  const arg = process.argv[3];
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL PRIMARY KEY,
      name        TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  if (cmd === 'up') {
    const all = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    for (const f of all) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name=$1', [f]);
      if (rows.length) { console.log(`skip   ${f}`); continue; }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      console.log(`apply  ${f}`);
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('INSERT INTO _migrations(name) VALUES($1)', [f]); await client.query('COMMIT'); }
      catch (e) { await client.query('ROLLBACK'); throw e; }
    }
    console.log('migrations: up-to-date');
  } else if (cmd === 'down') {
    const steps = parseInt(arg || '1', 10);
    const { rows } = await client.query('SELECT name FROM _migrations ORDER BY id DESC LIMIT $1', [steps]);
    for (const r of rows) {
      console.log(`revert ${r.name}`);
      await client.query('DELETE FROM _migrations WHERE name=$1', [r.name]);
    }
    console.log('NOTE: this is metadata-only rollback. Use pg_restore from backup if you need real rollback.');
  } else if (cmd === 'status') {
    const { rows } = await client.query('SELECT name, applied_at FROM _migrations ORDER BY id');
    console.table(rows);
  } else {
    console.error('usage: migrate.js [up|down N|status]');
    process.exit(1);
  }

  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
