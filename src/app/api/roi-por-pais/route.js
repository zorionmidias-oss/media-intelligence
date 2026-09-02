'use strict';
// ROI por país — grade de 7 dias (Visão geral). Fonte: ads_consolidados
// (pais_sigla, data, valor_gasto, faturamento_real). faturamento_real já é
// receita LÍQUIDA (×0.9 aplicado no sync) — NÃO reaplicar aqui.
const supabase = require('../../../lib/supabase');
const { fetchAll } = require('../../../lib/fetchAll');
const { hojeBR, addDiasISO } = require('../../../lib/datas');

// ROI por (país,dia) — mesma fórmula de src/app/api/relatorios/route.js (DERIVADAS.roi.calc).
function roiCalc(fat, gasto) {
  return gasto > 0 ? ((fat - gasto) / gasto) * 100 : null;
}

const isoRange = (since, until) => {
  const out = [];
  for (let d = since; d <= until; d = addDiasISO(d, 1)) out.push(d);
  return out;
};

async function handler(req, res) {
  try {
    const { domain } = req.query;
    // Task 14: janela FIXA — SEMPRE os últimos 7 dias no fuso BR (hoje inclusive),
    // desacoplada do calendário (since/until do topo não afeta este endpoint).
    const dt = hojeBR();
    const df = addDiasISO(dt, -6);
    const dias = Math.round((new Date(dt) - new Date(df)) / 86400000) + 1;

    // Janela anterior: mesma duração, terminando no dia anterior à janela atual.
    const prevDt = addDiasISO(df, -1);
    const prevDf = addDiasISO(prevDt, -(dias - 1));

    let domainId = null;
    if (domain && domain !== 'all') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', domain).maybeSingle();
      domainId = d?.id || null;
    }

    const restrito = Array.isArray(req.allowedDominios)
      ? (req.allowedDominios.length ? req.allowedDominios : [-1]) : null;

    // Uma query cobre as duas janelas (atual + anterior) — fetchAll pagina além
    // do corte de 1000 linhas do PostgREST (ver src/lib/fetchAll.js).
    const adsQ = () => {
      let q = supabase
        .from('ads_consolidados')
        .select('pais_sigla,data,valor_gasto,faturamento_real,dominio_id')
        .gte('data', prevDf).lte('data', dt);
      if (domainId) q = q.eq('dominio_id', domainId);
      if (restrito) q = q.in('dominio_id', restrito);
      return q;
    };
    const { data: rows, error } = await fetchAll(adsQ);
    if (error) return res.status(500).json({ error: error.message });

    // Agrupa por país+dia (soma gasto/faturamento).
    const byPais = new Map(); // pais_sigla -> Map(data -> {gasto, fat})
    for (const r of rows || []) {
      const pais = (r.pais_sigla || '').trim();
      if (!pais) continue;
      if (!byPais.has(pais)) byPais.set(pais, new Map());
      const porDia = byPais.get(pais);
      const dia = porDia.get(r.data) || { gasto: 0, fat: 0 };
      dia.gasto += Number(r.valor_gasto || 0);
      dia.fat += Number(r.faturamento_real || 0);
      porDia.set(r.data, dia);
    }

    const diasAtual = isoRange(df, dt);
    const diasAnterior = isoRange(prevDf, prevDt);
    const media = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

    // Só entram países com dado na janela atual (grade mostra quem está ativo agora).
    const paisesAtivos = [...byPais.keys()].filter((pais) => {
      const porDia = byPais.get(pais);
      return diasAtual.some((d) => porDia.has(d));
    });

    const out = paisesAtivos.map((pais) => {
      const porDia = byPais.get(pais);
      const serieDia = (d) => {
        const v = porDia.get(d) || { gasto: 0, fat: 0 };
        const roi = roiCalc(v.fat, v.gasto);
        return roi === null ? 0 : +roi.toFixed(2);
      };
      const roi7d = diasAtual.map(serieDia);
      const roiAnterior = diasAnterior.map(serieDia);
      const deltaPct = +(media(roi7d) - media(roiAnterior)).toFixed(1);
      return { pais, roi7d, deltaPct, _avg: media(roi7d) };
    });

    out.sort((a, b) => b._avg - a._avg);
    out.forEach((o) => delete o._avg);

    res.json(out);
  } catch (err) {
    console.error('[roi-por-pais]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
