'use strict';
// One-off: cria a tabela meta_entidades (dimensão da hierarquia Meta por id —
// ad_id → adset_id → campaign_id → page_id) e adiciona campaign_id/page_id em
// receita_ads + campaign_id em ads_consolidados. Base do cruzamento por id da
// aba Campanhas (nome vira só rótulo de exibição, nunca chave).
// Executar: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/_setup-meta-entidades.js
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg'); // devDependency

const SQL = `
CREATE TABLE IF NOT EXISTS public.meta_entidades (
  ad_id         text PRIMARY KEY,
  adset_id      text,
  campaign_id   text,
  page_id       text,
  ad_name       text,
  adset_name    text,
  campaign_name text,
  ad_utm        text,
  dominio_id    bigint,
  account_id    text,
  tipo          text,
  pais_sigla    text,
  nicho         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meta_entidades_campaign_idx ON public.meta_entidades (campaign_id);
CREATE INDEX IF NOT EXISTS meta_entidades_adset_idx    ON public.meta_entidades (adset_id);
CREATE INDEX IF NOT EXISTS meta_entidades_page_idx     ON public.meta_entidades (page_id);
CREATE INDEX IF NOT EXISTS meta_entidades_utm_idx      ON public.meta_entidades (ad_utm);

ALTER TABLE public.receita_ads ADD COLUMN IF NOT EXISTS campaign_id text;
ALTER TABLE public.receita_ads ADD COLUMN IF NOT EXISTS page_id     text;
CREATE INDEX IF NOT EXISTS receita_ads_campaign_idx ON public.receita_ads (campaign_id, data);
CREATE INDEX IF NOT EXISTS receita_ads_page_idx     ON public.receita_ads (page_id, data);

ALTER TABLE public.ads_consolidados ADD COLUMN IF NOT EXISTS campaign_id text;
CREATE INDEX IF NOT EXISTS ads_consolidados_campaign_idx ON public.ads_consolidados (campaign_id, data);

NOTIFY pgrst, 'reload schema';
`;

(async () => {
  const ref = (process.env.SUPABASE_URL || '').replace('https://', '').split('.')[0];
  console.log('Projeto alvo:', ref);
  if (ref !== 'vhqjkpspjpfewanlomwu') {
    console.log('❌ ref inesperado (esperado vhqjkpspjpfewanlomwu — banco do dashboard). Abortando.');
    process.exit(1);
  }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    await c.query(SQL);
    console.log('✅ meta_entidades criada + colunas campaign_id/page_id ok');
  } catch (e) {
    console.log('❌ falhou:', e.message);
    console.log('\n--- Rode este SQL no SQL Editor do projeto ' + ref + ' ---\n' + SQL);
    process.exit(2);
  } finally {
    await c.end().catch(() => {});
  }
})();
