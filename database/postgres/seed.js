#!/usr/bin/env node
/**
 * Dev seed data — admin user, default roles, default fees, default flags.
 * Idempotent. Safe to re-run.
 */
const { Client } = require('pg');

(async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(1); }
  const c = new Client({ connectionString: dbUrl });
  await c.connect();

  await c.query(`
    INSERT INTO auth.roles (name, permissions) VALUES
      ('admin',     ARRAY['*']),
      ('compliance',ARRAY['compliance:read','compliance:write','user:read','user:write']),
      ('support',   ARRAY['user:read','order:read','trade:read']),
      ('user',      ARRAY['me:read','me:write','order:write','trade:write'])
    ON CONFLICT (name) DO NOTHING;
  `);

  await c.query(`
    INSERT INTO fees.schedules (id, scope, kind, rate_bps) VALUES
      (gen_random_uuid(),'global','platform', 50),
      (gen_random_uuid(),'global','creator',  30),
      (gen_random_uuid(),'global','referral', 20),
      (gen_random_uuid(),'global','affiliate',10),
      (gen_random_uuid(),'global','burn',     5),
      (gen_random_uuid(),'global','treasury',15)
    ON CONFLICT DO NOTHING;
  `);

  await c.query(`
    INSERT INTO admin.feature_flags (name, enabled, description) VALUES
      ('launchpad_enabled', true,  'Allow new token launches'),
      ('trading_enabled',   true,  'Allow trading'),
      ('withdrawals_enabled', true,'Allow withdrawals'),
      ('signups_enabled',   true,  'Allow new signups')
    ON CONFLICT (name) DO NOTHING;
  `);

  // Demo admin (password: admin — change in real env)
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('admin', 10);
  await c.query(`
    INSERT INTO auth.users (email, username, password_hash, status, kyc_level, country_code)
    VALUES ('admin@localhost','admin',$1,'active',2,'IR')
    ON CONFLICT (email) DO NOTHING;
  `, [hash]);

  await c.end();
  console.log('seed: done');
})().catch(e => { console.error(e); process.exit(1); });
