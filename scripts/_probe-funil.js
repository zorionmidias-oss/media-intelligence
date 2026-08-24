'use strict';
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (label, sql) => { const r = await c.query(sql); console.log(label, JSON.stringify(r.rows)); };
  await q('funil totais:', "select count(*) linhas, count(distinct adset_id) conjuntos, min(data) lo, max(data) hi, sum(leads_entrada) leads, sum(sessoes) sessoes from funil_conjunto");
  await q('overlap adset com receita_ads (mesmo dia+adset):',
    "select count(*) casam from funil_conjunto f join receita_ads r on r.data=f.data and r.adset_id=f.adset_id");
  await q('funil sem receita (dia+adset):',
    "select count(*) so_funil from funil_conjunto f left join receita_ads r on r.data=f.data and r.adset_id=f.adset_id where r.adset_id is null");
  await q('receita sem funil (dia+adset):',
    "select count(*) so_receita from receita_ads r left join funil_conjunto f on r.data=f.data and r.adset_id=f.adset_id where f.adset_id is null and r.adset_id is not null");
  await q('amostra join completo (1 dia recente):',
    "select f.data, f.adset_id, f.leads_entrada, f.sessoes, r.impressoes imp_gam, r.receita_bruta from funil_conjunto f join receita_ads r on r.data=f.data and r.adset_id=f.adset_id where f.data='2026-08-20' and f.leads_entrada>0 order by f.sessoes desc limit 3");
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
