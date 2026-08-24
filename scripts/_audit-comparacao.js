'use strict';
// Quantifica o erro da seção "comparação vs período anterior" do Overview:
// atual usa blocos_anuncio (receita TOTAL), anterior usa ads_consolidados (receita ATRIBUÍDA).
const supabase = require('../src/lib/supabase');
const { fetchAll } = require('../src/lib/fetchAll');
const { hojeBR, diasAtrasBR, addDiasISO } = require('../src/lib/datas');

async function somas(since, until) {
  const { data: ads } = await fetchAll(() => supabase.from('ads_consolidados')
    .select('valor_gasto,faturamento_real').gte('data', since).lte('data', until));
  const { data: blo } = await fetchAll(() => supabase.from('blocos_anuncio')
    .select('receita_total').gte('data', since).lte('data', until));
  return {
    spend: ads.reduce((s, r) => s + Number(r.valor_gasto || 0), 0),
    fatAtrib: ads.reduce((s, r) => s + Number(r.faturamento_real || 0), 0),
    fatTotal: blo.reduce((s, r) => s + Number(r.receita_total || 0), 0) * 0.9,
  };
}
const v = (a, b) => (!b ? null : +((a - b) / Math.abs(b) * 100).toFixed(1));

(async () => {
  for (const dias of [7, 30]) {
    const df = diasAtrasBR(dias - 1), dt = hojeBR();
    const pdf = addDiasISO(df, -dias), pdt = addDiasISO(df, -1);
    const A = await somas(df, dt), P = await somas(pdf, pdt);

    const roiA = A.spend ? (A.fatTotal - A.spend) / A.spend * 100 : 0;
    const roiP_certo = P.spend ? (P.fatTotal - P.spend) / P.spend * 100 : 0;
    const roiP_bug = P.spend ? (P.fatAtrib - P.spend) / P.spend * 100 : 0;

    console.log(`\n===== ${dias}d: ${df}→${dt}  vs  ${pdf}→${pdt} =====`);
    console.log(`atual   : gasto R$${A.spend.toFixed(2)}  fatTOTAL R$${A.fatTotal.toFixed(2)}  fatATRIB R$${A.fatAtrib.toFixed(2)}`);
    console.log(`anterior: gasto R$${P.spend.toFixed(2)}  fatTOTAL R$${P.fatTotal.toFixed(2)}  fatATRIB R$${P.fatAtrib.toFixed(2)}  (atribuição ${(P.fatAtrib / P.fatTotal * 100).toFixed(0)}%)`);
    console.log('                        MOSTRADO(bug)   CORRETO');
    console.log(`faturamento variação : ${String(v(A.fatTotal, P.fatAtrib)).padStart(8)}%    ${String(v(A.fatTotal, P.fatTotal)).padStart(6)}%`);
    console.log(`lucro variação       : ${String(v(A.fatTotal - A.spend, P.fatAtrib - P.spend)).padStart(8)}%    ${String(v(A.fatTotal - A.spend, P.fatTotal - P.spend)).padStart(6)}%`);
    console.log(`roi delta (p.p.)     : ${String((roiA - roiP_bug).toFixed(1)).padStart(8)}     ${String((roiA - roiP_certo).toFixed(1)).padStart(6)}`);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
