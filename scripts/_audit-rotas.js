'use strict';
// Chama os handlers das rotas direto (sem HTTP/auth) e inspeciona o payload.
const { hojeBR, diasAtrasBR } = require('../src/lib/datas');

function call(handler, query) {
  return new Promise((resolve, reject) => {
    const req = { query, body: {}, params: {}, user: { id: 1 }, allowedDominios: null };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); },
      send(o) { resolve({ status: this.statusCode, body: o }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

(async () => {
  const overview = require('../src/app/api/overview/route');
  const periodos = [
    ['hoje', hojeBR(), hojeBR()],
    ['7d', diasAtrasBR(6), hojeBR()],
    ['30d', diasAtrasBR(29), hojeBR()],
  ];
  for (const [nome, since, until] of periodos) {
    const { status, body } = await call(overview, { since, until, domain: 'all' });
    if (status !== 200) { console.log(nome, 'ERRO', body); continue; }
    const k = body.kpis, c = body.comparacao;
    console.log(`\n########## OVERVIEW ${nome} (${since} → ${until}) ##########`);
    console.log('KPIs:', JSON.stringify({
      faturamento: k.faturamento, faturamento_bruto: k.faturamento_bruto, investimento: k.investimento,
      lucro: k.lucro, roi: k.roi, roas: k.roas, impressions: k.impressions, ecpm: k.ecpm,
      rps: k.rps, cpaIdeal: k.cpaIdeal, results: k.results, viewability: k.viewability,
      taxaProgramatica: k.taxaProgramatica, delayHours: k.delayHours, usdToBrl: k.usdToBrl,
    }, null, 1));
    console.log('comparacao (vs', c.periodo_anterior.since, '→', c.periodo_anterior.until, '):',
      JSON.stringify({ faturamento: c.faturamento, investimento: c.investimento, lucro: c.lucro, roi: c.roi }));
    console.log('trend dias:', body.trend.length, ' adsets:', body.adsets.length, ' adUnits:', body.adUnits.length);
    const somaAtrib = body.adsets.reduce((s, a) => s + a.faturado, 0);
    console.log(`receita atribuída (soma adsets) = R$${somaAtrib.toFixed(2)} vs KPI faturamento R$${k.faturamento.toFixed(2)}  → gap R$${(k.faturamento - somaAtrib).toFixed(2)} (${((1 - somaAtrib / (k.faturamento || 1)) * 100).toFixed(1)}% não atribuído)`);
    const custos = body.adsets.filter(a => a.costPerResult > 0).map(a => a.costPerResult);
    if (custos.length) console.log(`costPerResult: min=${Math.min(...custos).toFixed(4)} max=${Math.max(...custos).toFixed(4)}  cpaIdeal=${k.cpaIdeal}  → linhas pintadas de VERMELHO: ${custos.filter(x => x > k.cpaIdeal).length}/${custos.length}`);
    if (body.previsao) console.log('previsao:', JSON.stringify(body.previsao));
    console.log('utmCampaignTop3:', JSON.stringify(body.utmCampaignTop3));
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
