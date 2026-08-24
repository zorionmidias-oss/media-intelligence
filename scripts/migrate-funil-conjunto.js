'use strict';
/*
 * Cria a tabela funil_conjunto no banco do dash (grão conjunto=adset × dia).
 * Ponte trakeamento→dash: leads_entrada/sessões vivem no trakeamento; este é o destino no dash.
 * Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/migrate-funil-conjunto.js
 */
const { Client } = require('pg');

const SQL = `
create table if not exists funil_conjunto (
  data              date        not null,
  adset_id          text        not null,
  campaign_id       text,
  account_id        text,
  adset_name        text,
  -- bot (ancorado no dia do clique, captured_at)
  leads_entrada     integer     not null default 0,   -- cid únicos (denominador real de custo/lead)
  cliques_ad        integer     not null default 0,
  threads           integer     not null default 0,
  leads_qualificados integer    not null default 0,
  -- blog (ancorado no dia da sessão, occurred_at)
  sessoes           integer     not null default 0,
  leads_com_sessao  integer     not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (data, adset_id)
);
create index if not exists idx_funil_conjunto_data on funil_conjunto (data);
create index if not exists idx_funil_conjunto_campaign on funil_conjunto (campaign_id);
comment on table funil_conjunto is 'Agregados do trakeamento (leads/sessões) por adset×dia. Sync a partir de ybiibmvpmzmgfsmlrmjb. Bot ancora em captured_at; blog em occurred_at.';
`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(SQL);
  const r = await c.query("select count(*)::int n from funil_conjunto");
  console.log('funil_conjunto pronta. linhas atuais:', r.rows[0].n);
  await c.end();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
