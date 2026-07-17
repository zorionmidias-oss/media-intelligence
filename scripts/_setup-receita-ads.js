'use strict';
// One-off: cria a tabela receita_ads (receita GAM por ad_id/dia — base do ROI por conjunto
// no expand da aba Campanhas). Populada pelo sync a partir do gamByDay (utm_campaign = ad id).
// Executado em 16/07/2026 via DATABASE_URL (RPC execute_sql não existe neste projeto).
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg'); // devDependency

const SQL = `
CREATE TABLE IF NOT EXISTS public.receita_ads (
  data          date not null,
  ad_id         text not null,
  adset_id      text,
  ad_utm        text,
  dominio_id    bigint,
  receita_bruta numeric not null default 0,
  impressoes    bigint  not null default 0,
  cliques       bigint  not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (data, ad_id)
);
CREATE INDEX IF NOT EXISTS receita_ads_adset_idx ON public.receita_ads (adset_id, data);
CREATE INDEX IF NOT EXISTS receita_ads_utm_idx   ON public.receita_ads (ad_utm, data);
NOTIFY pgrst, 'reload schema';
`;

(async () => {
  const ref = (process.env.SUPABASE_URL || '').replace('https://', '').split('.')[0];
  console.log('Projeto alvo:', ref);
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    await c.query(SQL);
    console.log('✅ Tabela receita_ads criada/ok via DATABASE_URL');
  } catch (e) {
    console.log('❌ falhou:', e.message);
    console.log('\n--- Rode este SQL no SQL Editor do projeto ' + ref + ' ---\n' + SQL);
    process.exit(2);
  } finally {
    await c.end().catch(() => {});
  }
})();
