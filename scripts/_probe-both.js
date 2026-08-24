'use strict';
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const db = await c.query('select current_database() db');
  const t = await c.query('select count(*)::int n from ads_consolidados');
  console.log('DASH  db=%s ads_consolidados=%d', db.rows[0].db, t.rows[0].n);
  await c.end();

  const s = createClient(process.env.TRAKEAMENTO_SUPABASE_URL, process.env.TRAKEAMENTO_SERVICE_ROLE_KEY);
  const { count, error } = await s.from('ad_clicks').select('*', { count: 'exact', head: true });
  console.log('TRAK  ad_clicks=%s%s', count, error ? ' ERR ' + error.message : '');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
