'use strict';
/*
 * Cria meta_conjunto no banco do dash (métricas Meta por adset×dia, gasto já em BRL c/ imposto).
 * Fonte: agregação das linhas de anúncio dentro do syncAll (mesma conversão do ads_consolidados).
 * Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/migrate-meta-conjunto.js
 */
const { Client } = require('pg');

const SQL = `
create table if not exists meta_conjunto (
  data            date        not null,
  adset_id        text        not null,
  campaign_id     text,
  campaign_name   text,
  adset_name      text,
  account_id      text,
  dominio_id      integer,
  moeda           text,
  taxa_usd        numeric,
  imposto_perc    numeric,
  gasto_original  numeric     not null default 0,   -- moeda da conta
  gasto_brl       numeric     not null default 0,   -- BRL c/ imposto (mesma fórmula do ads_consolidados)
  impressoes      bigint      not null default 0,
  cliques_link    bigint      not null default 0,
  conversas_meta  integer     not null default 0,   -- mensagens iniciadas (Meta) — rótulo, NÃO denominador de custo/lead
  sessoes_meta    integer     not null default 0,   -- view_content (Meta) — NÃO é sessão do blog
  results         integer     not null default 0,
  orcamento_brl   numeric     not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (data, adset_id)
);
create index if not exists idx_meta_conjunto_data on meta_conjunto (data);
create index if not exists idx_meta_conjunto_campaign on meta_conjunto (campaign_id);
create index if not exists idx_meta_conjunto_dominio on meta_conjunto (dominio_id);
comment on table meta_conjunto is 'Métricas Meta por conjunto(adset)×dia. Gasto em BRL c/ imposto, mesma conversão do ads_consolidados. Agregado no syncAll a partir das linhas de anúncio (com adset_id). conversas_meta/sessoes_meta são contadores Meta (rótulo), não os denominadores reais do funil (esses vêm de funil_conjunto).';
`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(SQL);
  const r = await c.query('select count(*)::int n from meta_conjunto');
  console.log('meta_conjunto pronta. linhas atuais:', r.rows[0].n);
  await c.end();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
