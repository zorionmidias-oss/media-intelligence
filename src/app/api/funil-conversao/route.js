'use strict';
/*
 * /api/funil-conversao — Funil de Conversão da Visão geral (spec
 * docs/superpowers/specs/2026-11-23-funil-conversao-design.md).
 *
 * Etapas: cliques (Meta) → conversas (cid únicos do bot) → página abriu (leads com sessão
 * no blog) → visualização de conteúdo (ViewContent Meta) → impressões GAM.
 * Reusa buscarLinhas do diagnóstico (meta_conjunto + funil_conjunto + receita_ads por
 * data×conjunto). Soma antes de dividir — nunca média de taxas.
 *
 * Referência do gargalo = mediana das taxas DIÁRIAS dos 7 dias fechados anteriores ao
 * `since`, no mesmo escopo (geral ou campanha).
 *
 * Query: ?since & until & domain
 */
const supabase = require('../../../lib/supabase');
const { hojeBR, addDiasISO } = require('../../../lib/datas');
const { buscarLinhas } = require('../diagnostico/route');

const ETAPAS = ['cliques', 'conversas', 'conversas_meta', 'pagina_abriu', 'vc', 'imp_gam'];
// passagens: [chave, de, para]
const PASSAGENS = [['t12', 'cliques', 'conversas'], ['t23', 'conversas', 'pagina_abriu'],
  ['t34', 'pagina_abriu', 'vc'], ['x45', 'vc', 'imp_gam']];

function somar(linhas) {
  const s = { gasto: 0 };
  for (const k of ETAPAS) s[k] = 0;
  for (const l of linhas) {
    s.gasto += Number(l.gasto_brl || 0);
    s.cliques += Number(l.cliques_link || 0);
    s.conversas += Number(l.leads_entrada || 0);
    s.conversas_meta += Number(l.conversas_meta || 0);
    s.pagina_abriu += Number(l.leads_com_sessao || 0);
    s.vc += Number(l.sessoes_meta || 0);
    s.imp_gam += Number(l.impressoes_gam || 0);
  }
  s.gasto = +s.gasto.toFixed(2);
  return s;
}

function taxa(s, de, para) { return s[de] > 0 ? s[para] / s[de] : null; }

function mediana(vals) {
  const v = vals.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Mediana das taxas diárias de cada passagem nas linhas de referência (um valor por dia).
function referencia(linhasRef) {
  const porDia = new Map();
  for (const l of linhasRef) {
    if (!porDia.has(l.data)) porDia.set(l.data, []);
    porDia.get(l.data).push(l);
  }
  const dias = [...porDia.values()].map(somar);
  const ref = {};
  for (const [k, de, para] of PASSAGENS) {
    const r = mediana(dias.map((s) => taxa(s, de, para)));
    ref[k] = r != null ? +r.toFixed(4) : null;
  }
  return ref;
}

function montarFunil(linhasPeriodo, linhasRef, extra) {
  const etapas = somar(linhasPeriodo);
  const taxas = {};
  for (const [k, de, para] of PASSAGENS) {
    const t = taxa(etapas, de, para);
    taxas[k] = t != null ? +t.toFixed(4) : null;
  }
  return { ...extra, gasto: etapas.gasto, etapas, taxas, ref: referencia(linhasRef) };
}

async function handler(req, res) {
  try {
    const until = req.query.until || hojeBR();
    const since = req.query.since || until;
    const refIni = addDiasISO(since, -7);
    const refFim = addDiasISO(since, -1);

    let dominioId = null;
    if (req.query.domain && req.query.domain !== 'all') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', req.query.domain).maybeSingle();
      dominioId = d?.id ?? null;
    }
    const restrito = Array.isArray(req.allowedDominios)
      ? (req.allowedDominios.length ? req.allowedDominios : [-1]) : null;

    const linhas = await buscarLinhas(refIni, until, dominioId, restrito);
    const periodo = linhas.filter((l) => l.data >= since && l.data <= until);
    const ref = linhas.filter((l) => l.data >= refIni && l.data <= refFim);

    const geral = montarFunil(periodo, ref, { nome: 'Geral' });

    const porCamp = new Map();
    for (const l of periodo) {
      if (!l.campaign_id) continue;
      if (!porCamp.has(l.campaign_id)) porCamp.set(l.campaign_id, { nome: l.campaign_name, linhas: [] });
      porCamp.get(l.campaign_id).linhas.push(l);
    }
    const campanhas = [...porCamp.entries()]
      .map(([id, c]) => montarFunil(c.linhas, ref.filter((l) => l.campaign_id === id),
        { campaign_id: id, nome: c.nome || id }))
      .filter((f) => f.gasto > 0)
      .sort((a, b) => b.gasto - a.gasto);

    res.json({ since, until, ref_janela: { de: refIni, ate: refFim }, geral, campanhas });
  } catch (e) {
    console.error('[/api/funil-conversao]', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = handler;
