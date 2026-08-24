'use strict';
// Compara PAR de várias fontes p/ achar por que o PAR do diagnóstico parece errado.
const { Client } = require('pg');
const DIA = process.argv[2] || '2026-08-22';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (l, sql) => { const r = await c.query(sql, [DIA]); console.log(l, JSON.stringify(r.rows[0])); };

  console.log('=== DIA', DIA, '===');
  await q('receita_ads (attrib por ad_id):', `select sum(impressoes)::bigint imp, sum(receita_bruta)::numeric(12,2) rev, count(*) linhas, count(distinct adset_id) adsets from receita_ads where data=$1`);
  await q('funil_conjunto sessoes (blog):', `select sum(sessoes)::bigint sess, sum(leads_entrada)::bigint leads, count(distinct adset_id) adsets from funil_conjunto where data=$1`);
  await q('ads_consolidados (dash):', `select sum(impressoes_gam)::bigint imp_gam, sum(sessoes_meta)::bigint sess_meta, sum(resultado)::bigint result from ads_consolidados where data=$1`);
  await q('blocos_anuncio (GAM ad units, TODOS):', `select sum(impressoes)::bigint imp, sum(receita_bruta)::numeric(12,2) rev, count(*) linhas from blocos_anuncio where data=$1`);
  await q('meta_conjunto:', `select sum(impressoes)::bigint imp_meta, sum(sessoes_meta)::bigint sess_meta, sum(gasto_brl)::numeric(12,2) gasto from meta_conjunto where data=$1`);

  // PARs calculados
  const r = await c.query(`
    with ra as (select sum(impressoes) imp from receita_ads where data=$1),
         fc as (select sum(sessoes) sess from funil_conjunto where data=$1),
         ac as (select sum(impressoes_gam) imp, sum(sessoes_meta) sess from ads_consolidados where data=$1),
         ba as (select sum(impressoes) imp from blocos_anuncio where data=$1)
    select (select imp from ra)::numeric/nullif((select sess from fc),0) par_diag_blogsess,
           (select imp from ra)::numeric/nullif((select sess from ac),0) par_receita_metasess,
           (select imp from ac)::numeric/nullif((select sess from ac),0) par_dash,
           (select imp from ba)::numeric/nullif((select sess from fc),0) par_blocos_blogsess,
           (select imp from ba)::numeric/nullif((select sess from ac),0) par_blocos_metasess
  `, [DIA]);
  console.log('\nPAR por fonte:');
  const p = r.rows[0];
  for (const k in p) console.log('  '+k.padEnd(26), p[k]!=null?(+p[k]).toFixed(3):'null');
  await c.end();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
