'use strict';
/*
 * Valida o motor src/lib/diagnostico.js contra o banco, nível GERAL, 1 dia fechado.
 * Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/_test-diagnostico.js [DIA] [DOMINIO_ID]
 */
const { Client } = require('pg');
const D = require('../src/lib/diagnostico');

const DIA = process.argv[2] || '2026-08-22';
const DOM = process.argv[3] ? Number(process.argv[3]) : null;
const medIni = shift(DIA, -6); // 7 dias terminando no DIA

function shift(iso, d) { const dt = new Date(iso + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + d); return dt.toISOString().slice(0, 10); }

const JOIN = (col) => `
  with r as (select data, adset_id, sum(impressoes) imp_gam, sum(receita_bruta) receita_bruta
             from receita_ads where data between $1 and $2 group by data, adset_id)
  select m.data::text as data, m.adset_id, m.campaign_id, m.campaign_name, m.adset_name, m.account_id, m.dominio_id,
         m.gasto_brl, m.impressoes as impressoes_meta, m.cliques_link, m.conversas_meta, m.sessoes_meta,
         m.results, m.orcamento_brl,
         coalesce(f.leads_entrada,0) leads_entrada, coalesce(f.cliques_ad,0) cliques_ad,
         coalesce(f.threads,0) threads, coalesce(f.leads_qualificados,0) leads_qualificados,
         coalesce(f.sessoes,0) sessoes, coalesce(f.leads_com_sessao,0) leads_com_sessao,
         coalesce(r.imp_gam,0) impressoes_gam, coalesce(r.receita_bruta,0) receita_bruta
  from meta_conjunto m
  left join funil_conjunto f on f.data=m.data and f.adset_id=m.adset_id
  left join r on r.data=m.data and r.adset_id=m.adset_id
  where m.data between $1 and $2 ${col}`;

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // cobertura de dominio_id
  const cov = await c.query('select count(*)::int tot, count(dominio_id)::int com_dom from meta_conjunto');
  console.log(`meta_conjunto: ${cov.rows[0].com_dom}/${cov.rows[0].tot} linhas com dominio_id`);

  // config global
  const cfgRows = (await c.query('select chave, valor from diagnostico_config where dominio_id is null')).rows;
  const cfg = { ...D.CFG_PADRAO }; for (const r of cfgRows) cfg[r.chave] = Number(r.valor);

  const filtro = DOM ? 'and m.dominio_id = $3' : '';
  const params = DOM ? [medIni, DIA, DOM] : [medIni, DIA];
  const rows = (await c.query(JOIN(filtro), params)).rows;
  await c.end();

  // referência 7d (medianas do domínio/conta) usando toda a janela medIni..DIA
  const medianas = D.medianas7d(rows, cfg.taxa_gam);
  // linhas só do DIA
  const doDia = rows.filter(r => r.data === DIA || String(r.data).slice(0,10) === DIA);

  console.log(`\nDIA ${DIA} | janela mediana ${medIni}→${DIA} (${medianas._amostraDias} dias) | dominio ${DOM ?? 'ALL'}`);
  console.log('linhas no dia:', doDia.length, '| conjuntos:', new Set(doDia.map(r=>r.adset_id)).size);

  // ── nível GERAL: agrega o dia inteiro ──
  const geral = D.diagnosticarConjunto(doDia, medianas, cfg, {});
  console.log('\n── GERAL (dia agregado) ──');
  console.log('gasto R$', geral.gasto, '| receita_liq R$', geral.receita_liq, '| ROAS', geral.roas, '| ROAS_ref', geral.roas_ref, '| produto', geral.produto);
  console.log('validação: reconstruído', geral.validacao.reconstruido, 'vs direto', geral.validacao.direto, '→ div', (geral.validacao.divergencia*100).toFixed(2)+'%');
  console.log('nós:');
  for (const n of geral.fatores) console.log(`  ${n.label.padEnd(16)} valor=${n.valor}  med=${n.mediana}  fator=${n.fator}× (${n.delta!=null?(n.delta*100).toFixed(0)+'%':'—'}) [${n.classe}]${n.piso_falha?' PISO!':''}`);
  console.log('gargalo:', geral.gargalo?.label, geral.gargalo?.fator, '×');
  console.log('potencial:', JSON.stringify(geral.potencial));

  // ── por conjunto + classificação do gargalo dominante ──
  const byAdset = new Map();
  for (const r of doDia) { if (!byAdset.has(r.adset_id)) byAdset.set(r.adset_id, []); byAdset.get(r.adset_id).push(r); }
  const conjuntos = [...byAdset.values()].map(ls => D.diagnosticarConjunto(ls, medianas, cfg, {}));
  const comVerd = conjuntos.filter(c => c.veredito.classe !== 'mute');
  console.log(`\n── CONJUNTOS: ${conjuntos.length} total | ${comVerd.length} com veredito (≥ piso volume) ──`);
  const distr = {}; for (const c of comVerd) distr[c.veredito.rotulo.split(' · ')[0]] = (distr[c.veredito.rotulo.split(' · ')[0]]||0)+1;
  console.log('distribuição de veredito:', JSON.stringify(distr));
  if (geral.gargalo) console.log('classificação do gargalo geral:', JSON.stringify(D.classificarGargalo(geral.gargalo.chave, conjuntos, cfg)));

  // reconstrução por conjunto (sanity)
  let ok=0, tot=0; for (const c of conjuntos) { if (c.validacao.divergencia!=null){tot++; if(c.validacao.divergencia<=0.02)ok++;} }
  console.log(`reconstrução por conjunto dentro de 2%: ${ok}/${tot}`);
})().catch(e => { console.error('FALHOU:', e.stack || e.message); process.exit(1); });
