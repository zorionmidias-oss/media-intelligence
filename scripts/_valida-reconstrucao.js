'use strict';
/*
 * Checkpoint §14/§15: reconstrução do ROAS = produto dos 4 fatores bate com receita÷investimento?
 * Junta meta_conjunto (gasto) + funil_conjunto (leads/sessões) + receita_ads (GAM) por conjunto,
 * agrega a janela (soma-antes-de-dividir) e compara roas_reconstruido vs roas_direto.
 */
const { Client } = require('pg');
const TAXA = 0.10;
const SINCE = process.argv[2] || '2026-08-14';
const UNTIL = process.argv[3] || '2026-08-23';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  // agrega por conjunto na janela: gasto (meta), leads/sessoes (funil), imp/receita (GAM)
  const { rows } = await c.query(`
    with m as (select adset_id, sum(gasto_brl) inv from meta_conjunto where data between $1 and $2 group by adset_id),
         f as (select adset_id, sum(leads_entrada) leads, sum(sessoes) sess from funil_conjunto where data between $1 and $2 group by adset_id),
         g as (select adset_id, sum(impressoes) imp, sum(receita_bruta) rev from receita_ads where data between $1 and $2 group by adset_id)
    select m.adset_id, m.inv, f.leads, f.sess, g.imp, g.rev
    from m join f on f.adset_id=m.adset_id join g on g.adset_id=m.adset_id
  `, [SINCE, UNTIL]);
  await c.end();

  let completos = 0, dentro2 = 0, foraExemplos = [];
  for (const r of rows) {
    const inv = +r.inv, leads = +r.leads, sess = +r.sess, imp = +r.imp, revLiq = +r.rev * (1 - TAXA);
    if (!(inv > 0 && leads > 0 && sess > 0 && imp > 0 && revLiq > 0)) continue; // funil completo
    completos++;
    const custoLead = inv / leads, spl = sess / leads, par = imp / sess, ecpmBruto = (+r.rev) / imp * 1000;
    const roasRecon = spl * par * ecpmBruto * (1 - TAXA) / (1000 * custoLead);
    const roasDireto = revLiq / inv;
    const err = Math.abs(roasRecon - roasDireto) / roasDireto;
    if (err <= 0.02) dentro2++;
    else if (foraExemplos.length < 5) foraExemplos.push({ adset: r.adset_id, roasRecon: +roasRecon.toFixed(3), roasDireto: +roasDireto.toFixed(3), err: +(err * 100).toFixed(1) });
  }
  console.log(`Janela ${SINCE}→${UNTIL}`);
  console.log(`conjuntos com funil completo: ${completos}`);
  console.log(`reconstrução dentro de 2%: ${dentro2}/${completos} = ${completos ? (100 * dentro2 / completos).toFixed(2) : 0}%`);
  if (foraExemplos.length) console.log('fora de 2% (amostra):', JSON.stringify(foraExemplos));
})().catch(e => { console.error(e.message); process.exit(1); });
