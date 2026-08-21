#!/usr/bin/env node
/**
 * Minimal forward-only migrator.
 *   node database/postgres/migrate.js up
 *   node database/postgres/migrate.js down 1
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATION_SOURCES = [
  { prefix: '', dir: path.join(__dirname, 'migrations') },
  { prefix: 'wallet::', dir: path.join(__dirname, '..', '..', 'wallet-service', 'migrations') },
];

function migrationFiles() {
  return MIGRATION_SOURCES.flatMap(({ prefix, dir }) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((file) => ({ name: `${prefix}${file}`, path: path.join(dir, file) }));
  });
}

async function main() {
  const cmd = process.argv[2] || 'up';
  const arg = process.argv[3];
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  // Serialize migration runners across replicas/deployments. The connection
  // closing on failure also releases the PostgreSQL session-level lock.
  await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['rial.schema.migrations']);

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL PRIMARY KEY,
      name        TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  if (cmd === 'up') {
    const all = migrationFiles();
    for (const migration of all) {
      const { rows } = await client.query('SELECT 1 FROM _migrations WHERE name=$1', [migration.name]);
      if (rows.length) { console.log(`skip   ${migration.name}`); continue; }
      const sql = fs.readFileSync(migration.path, 'utf8');
      console.log(`apply  ${migration.name}`);
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('INSERT INTO _migrations(name) VALUES($1)', [migration.name]); await client.query('COMMIT'); }
      catch (e) { await client.query('ROLLBACK'); throw e; }
    }
    console.log('migrations: up-to-date');
  } else if (cmd === 'down') {
    if (process.env.ALLOW_METADATA_ONLY_DOWN !== 'true') {
      throw new Error('metadata-only rollback is disabled; set ALLOW_METADATA_ONLY_DOWN=true only for controlled recovery');
    }
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

  await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['rial.schema.migrations']);
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
