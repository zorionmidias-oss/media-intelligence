'use strict';
/* Exercita o handler /api/diagnostico direto (sem HTTP) nos 3 níveis.
 * Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/_test-rota-diag.js [UNTIL] */
const handler = require('../src/app/api/diagnostico/route');
const UNTIL = process.argv[2] || '2026-08-22';

function fakeRes() {
  return { _code: 200, _json: null,
    status(c) { this._code = c; return this; },
    json(o) { this._json = o; return this; } };
}
async function call(query) {
  const res = fakeRes();
  await handler({ query, allowedDominios: undefined }, res);
  if (res._code !== 200) throw new Error('HTTP ' + res._code + ' ' + JSON.stringify(res._json));
  return res._json;
}

(async () => {
  // GERAL
  const g = await call({ nivel: 'geral', until: UNTIL });
  console.log('═══ GERAL', UNTIL, '═══');
  console.log('janela mediana:', g.mediana_janela, '| conjuntos:', g.conjuntos_total);
  console.log('ROAS', g.geral.roas, '| ref', g.geral.roas_ref, '| produto', g.geral.produto,
    '| validação div', (g.geral.validacao.divergencia*100).toFixed(2)+'%');
  console.log('gargalo:', g.geral.gargalo?.label, g.geral.gargalo?.fator+'×',
    '→ classificação', g.classificacao_gargalo?.classe,
    `(${(g.classificacao_gargalo?.pct_conjuntos*100).toFixed(0)}% conj / ${(g.classificacao_gargalo?.pct_gasto*100).toFixed(0)}% gasto)`);
  console.log('alertas de piso:', g.alertas_piso.map(a => `${a.label} ${a.valor}<${a.piso} [${a.classificacao?.classe}]`).join(' | ') || 'nenhum');
  console.log('veredito distr:', JSON.stringify(g.distribuicao_veredito));

  // CAMPANHA
  const c = await call({ nivel: 'campanha', until: UNTIL });
  console.log('\n═══ CAMPANHA (7d) ═══  campanhas:', c.campanhas.length);
  for (const cp of c.campanhas.slice(0, 5)) {
    console.log(` ${(cp.campaign_name||cp.campaign_key||'?').slice(0,34).padEnd(34)} ROAS ${String(cp.roas).padStart(6)} | gasto ${String(cp.gasto).padStart(8)} | gargalo ${cp.gargalo?.label||'—'} ${cp.gargalo?.fator||''}× | ${cp.veredito.rotulo} | ${cp.conjuntos.length} conj`);
  }

  // CONJUNTO — pega o pior conjunto com volume da lista
  const lista = await call({ nivel: 'conjunto', until: UNTIL });
  const alvo = lista.conjuntos.find(x => x.veredito.classe !== 'mute') || lista.conjuntos[0];
  console.log('\n═══ CONJUNTO (14d) ═══  total:', lista.conjuntos.length, '| alvo:', alvo?.adset_id);
  if (alvo) {
    const one = await call({ nivel: 'conjunto', until: UNTIL, adset_id: alvo.adset_id });
    const cj = one.conjunto;
    console.log(`adset ${cj.adset_id} | D${cj.dias} | gasto ${cj.gasto} | ROAS ${cj.roas} | ${cj.veredito.rotulo}`);
    console.log('fatores:', cj.fatores.map(n => `${n.chave}=${n.fator}×`).join(' '));
    console.log('gargalos rankeados:', one.gargalos.map(gg => `${gg.label}(${gg.fator}×→${gg.potencial})`).join(' | '));
    console.log('vazamento:', JSON.stringify(cj.vazamento));
    console.log('validação conj: recon', cj.validacao.reconstruido, 'vs direto', cj.validacao.direto);
  }
})().catch(e => { console.error('FALHOU:', e.stack || e.message); process.exit(1); });
