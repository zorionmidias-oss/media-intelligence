'use strict';
// "todos os dados estão incorretos": cruza as fontes do diagnóstico vs ads_consolidados (dash).
const { Client } = require('pg');
const DIA = process.argv[2] || '2026-08-22';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const one = async (sql, p=[DIA]) => (await c.query(sql, p)).rows;

  console.log('=== DIA', DIA, '— TOTAIS ===');
  const mc = (await one(`select sum(gasto_brl)::numeric(14,2) gasto, count(*) linhas, count(distinct adset_id) adsets from meta_conjunto where data=$1`))[0];
  const ra = (await one(`select sum(receita_bruta)::numeric(14,2) rev_bruta, sum(impressoes)::bigint imp from receita_ads where data=$1`))[0];
  const ac = (await one(`select sum(valor_gasto)::numeric(14,2) gasto, sum(faturamento_real)::numeric(14,2) fat_real, sum(impressoes_gam)::bigint imp, count(*) linhas from ads_consolidados where data=$1`))[0];
  const fc = (await one(`select sum(sessoes)::bigint sess, sum(leads_entrada)::bigint leads from funil_conjunto where data=$1`))[0];
  console.log('meta_conjunto   gasto=%s  adsets=%s  linhas=%s', mc.gasto, mc.adsets, mc.linhas);
  console.log('ads_consolidados gasto=%s  fat_real=%s  imp_gam=%s  linhas=%s', ac.gasto, ac.fat_real, ac.imp, ac.linhas);
  console.log('receita_ads     rev_bruta=%s  (×0.9=%s)  imp=%s', ra.rev_bruta, (ra.rev_bruta*0.9).toFixed(2), ra.imp);
  console.log('funil_conjunto  sess=%s  leads=%s', fc.sess, fc.leads);
  console.log('');
  console.log('GASTO  diag(meta_conjunto)=%s  vs  dash(ads_consolidados)=%s  → dif %s%%',
    mc.gasto, ac.gasto, ac.gasto>0?((mc.gasto/ac.gasto-1)*100).toFixed(1):'—');
  console.log('RECEITA LIQ  diag(receita_ads×0.9)=%s  vs  dash(fat_real)=%s  → dif %s%%',
    (ra.rev_bruta*0.9).toFixed(2), ac.fat_real, ac.fat_real>0?(((ra.rev_bruta*0.9)/ac.fat_real-1)*100).toFixed(1):'—');
  console.log('ROAS  diag=%s  vs  dash=%s',
    (ra.rev_bruta*0.9/mc.gasto).toFixed(3), (ac.fat_real/ac.gasto).toFixed(3));

  // por conjunto: top 8 por gasto, comparando meta_conjunto vs ads_consolidados por campaign
  console.log('\n=== por CAMPANHA (top 8 gasto, meta_conjunto vs ads_consolidados) ===');
  const rows = await one(`
    with m as (select campaign_id, campaign_name, sum(gasto_brl) gasto from meta_conjunto where data=$1 group by campaign_id, campaign_name),
         a as (select campaign_id, sum(valor_gasto) gasto, sum(faturamento_real) fat from ads_consolidados where data=$1 and campaign_id is not null group by campaign_id)
    select m.campaign_name, m.gasto gmeta, a.gasto gads, a.fat
    from m left join a on a.campaign_id=m.campaign_id
    order by m.gasto desc limit 8`);
  for (const r of rows) {
    const dif = r.gads>0 ? ((r.gmeta/r.gads-1)*100).toFixed(0)+'%' : (r.gads==null?'SEM ADS':'—');
    console.log(`${String(r.campaign_name||'?').slice(0,40).padEnd(40)} meta=${(+r.gmeta).toFixed(2).padStart(9)} ads=${r.gads!=null?(+r.gads).toFixed(2).padStart(9):'   null'} dif=${dif}`);
  }
  await c.end();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
