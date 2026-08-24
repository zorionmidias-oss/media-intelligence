'use strict';
// Diagnóstico read-only: por que a linha-mãe da campanha (ads_consolidados por
// campaign_id) não bate com a soma dos conjuntos (receita_ads por ad_id + Meta live).
// Alvo: mkuker.com / folasadeadeyemifb / ZA. Ajuste UTM/DIAS via argv.
const supabase = require('../src/lib/supabase');

const UTM  = process.argv[2] || 'folasadeadeyemifb';
const DIAS = Number(process.argv[3] || 30);

function d(n){ return `R$ ${Number(n||0).toFixed(2)}`; }

(async () => {
  const until = new Date();
  const since = new Date(Date.now() - DIAS*864e5);
  const sinceISO = since.toISOString().slice(0,10);
  const untilISO = until.toISOString().slice(0,10);
  console.log(`\n== UTM=${UTM}  período ${sinceISO}..${untilISO} (${DIAS}d) ==\n`);

  // 1) Linhas de ads_consolidados desse UTM no período
  const { data: rows, error } = await supabase
    .from('ads_consolidados')
    .select('data,campaign_id,ad_utm,dominio_id,pais_sigla,valor_gasto,faturamento_real,faturamento_bruto,resultado,gam_match')
    .eq('ad_utm', UTM)
    .gte('data', sinceISO).lte('data', untilISO)
    .order('data');
  if (error) { console.error('erro ads_consolidados:', error.message); process.exit(1); }
  console.log(`ads_consolidados: ${rows.length} linhas\n`);

  // 2) Agrupa por campaign_id (carimbado) vs legado (null)
  const byKey = {};
  for (const r of rows) {
    const k = r.campaign_id ? `campaign_id=${r.campaign_id}` : `·legado (null) ${r.dominio_id}|${r.pais_sigla||''}`;
    (byKey[k] ||= { gasto:0, fat:0, bruto:0, res:0, n:0, matches:{} });
    const g = byKey[k];
    g.gasto += +r.valor_gasto||0; g.fat += +r.faturamento_real||0;
    g.bruto += +r.faturamento_bruto||0; g.res += +r.resultado||0; g.n++;
    g.matches[r.gam_match||'null'] = (g.matches[r.gam_match||'null']||0)+1;
  }
  console.log('── ads_consolidados agrupado (como a linha-mãe faz) ──');
  for (const [k,g] of Object.entries(byKey)) {
    console.log(`  ${k}`);
    console.log(`     gasto=${d(g.gasto)}  fat_real=${d(g.fat)}  bruto=${d(g.bruto)}  resultado=${g.res}  linhas=${g.n}  gam_match=${JSON.stringify(g.matches)}`);
  }

  // 3) Pega o campaign_id dominante
  const campKeys = Object.keys(byKey).filter(k=>k.startsWith('campaign_id='));
  const campId = campKeys.length ? campKeys[0].split('=')[1] : null;
  if (!campId) { console.log('\n(sem campaign_id carimbado — tudo caiu no legado)\n'); process.exit(0); }

  // 4) ad_ids da campanha via meta_entidades (dimensão)
  const { data: ents } = await supabase
    .from('meta_entidades')
    .select('ad_id,ad_nome,adset_nome,status')
    .eq('campaign_id', campId);
  const adIds = (ents||[]).map(e=>String(e.ad_id));
  console.log(`\n── meta_entidades: ${adIds.length} ad_ids na campanha ${campId} ──`);

  // 5) receita_ads DIRETO por campaign_id no período (fonte GAM por id)
  const { data: rec, error: recErr } = await supabase
    .from('receita_ads')
    .select('ad_id,receita_bruta,data,campaign_id')
    .eq('campaign_id', campId)
    .gte('data', sinceISO).lte('data', untilISO);
  if (recErr) console.error('erro receita_ads:', recErr.message);
  let recBruta = 0, recPorAd = {}, recPorDia = {};
  for (const r of rec||[]) {
    recBruta += +r.receita_bruta||0;
    recPorAd[r.ad_id]=(recPorAd[r.ad_id]||0)+(+r.receita_bruta||0);
    recPorDia[r.data]=(recPorDia[r.data]||0)+(+r.receita_bruta||0);
  }
  const recLiquida = recBruta * 0.9;
  console.log(`receita_ads: ${(rec||[]).length} linhas, ${Object.keys(recPorAd).length} ad_ids distintos`);

  // Quebra por dia: ads_consolidados.faturamento_bruto vs receita_ads.receita_bruta
  const consPorDia = {};
  for (const r of rows) if (r.campaign_id===campId) consPorDia[r.data]=(consPorDia[r.data]||0)+(+r.faturamento_bruto||0);
  console.log('\n── bruto por dia: [consolidado] vs [receita_ads] ──');
  const dias = [...new Set([...Object.keys(consPorDia),...Object.keys(recPorDia)])].sort();
  for (const dia of dias) {
    const c=consPorDia[dia]||0, ra=recPorDia[dia]||0;
    const flag = Math.abs(c-ra)>0.01 ? '  ⚠ DIVERGE' : '';
    console.log(`  ${dia}  cons=${d(c)}  receita_ads=${d(ra)}${flag}`);
  }

  console.log('\n════════ COMPARAÇÃO ════════');
  const mae = byKey[`campaign_id=${campId}`];
  console.log(`LINHA-MÃE (ads_consolidados.faturamento_real):  ${d(mae.fat)}`);
  console.log(`CONJUNTOS (receita_ads por ad_id × 0.9):        ${d(recLiquida)}   [bruta ${d(recBruta)}]`);
  console.log(`GAP receita:                                    ${d(recLiquida - mae.fat)}`);
  console.log(`\nMÃE gasto (sincronizado): ${d(mae.gasto)}   (conjuntos usam Meta live, não dá pra comparar sem chamar a API)`);
  console.log('\n── receita_ads por ad_id (top) ──');
  Object.entries(recPorAd).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([id,v])=>{
    const e=(ents||[]).find(x=>String(x.ad_id)===id);
    console.log(`  ${id}  ${d(v)}  ${e?.status||'?'}  ${e?.adset_nome||''}`);
  });
  process.exit(0);
})();
