'use strict';
const supabase = require('../../../lib/supabase');

async function handler(req, res) {
  try {
    const { since, until, domain, tipo } = req.query;
    const now = new Date();
    const defaultSince = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const defaultUntil = now.toISOString().slice(0, 10);

    const dateFrom = since || defaultSince;
    const dateTo = until || defaultUntil;

    // Filter by domain (join dominios)
    let domainId = null;
    if (domain && domain !== 'all') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', domain).maybeSingle();
      domainId = d?.id || null;
    }

    // Query ads_consolidados
    let query = supabase
      .from('ads_consolidados')
      .select('*,dominios(nome,prefixo_campanha)')
      .gte('data', dateFrom)
      .lte('data', dateTo)
      .order('valor_gasto', { ascending: false });

    if (tipo && tipo !== 'all') query = query.eq('tipo', tipo);
    if (domainId) query = query.eq('dominio_id', domainId);

    const { data: rows, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Aggregate by (dominio_id, ad_utm) across date range — same UTM from
    // multiple accounts merges into one row (prevents double-counting GAM revenue)
    const utmMap = {};
    for (const r of rows || []) {
      const key = `${r.dominio_id}|${r.ad_utm}|${r.pais_sigla || ''}`;
      if (!utmMap[key]) {
        utmMap[key] = {
          ad_utm: r.ad_utm,
          tipo: r.tipo,
          dominio: r.dominios?.nome || null,
          campanha_meta: r.campanha_meta,
          pais_sigla: r.pais_sigla || '',
          pais_nome: r.pais_nome || '',
          valor_gasto: 0,
          faturamento_real: 0,
          faturamento_bruto: 0,
          lucro: 0,
          cliques: 0,
          impressoes_gam: 0,
          resultado: 0,
          orcamento_total: 0,
          // Weighted accumulation
          _cpcSum: 0, _cpcW: 0,
          _ctrSum: 0, _ctrW: 0,
          _ecpmSum: 0, _ecpmW: 0,
          _rpsSum: 0, _rpsW: 0,
          // Previsão (today's row only)
          previsao_impressoes: 0,
          previsao_faturamento_real: 0,
          previsao_lucro: 0,
          previsao_roas: 0,
        };
      }
      const g = utmMap[key];
      g.valor_gasto += Number(r.valor_gasto || 0);
      g.faturamento_real += Number(r.faturamento_real || 0);
      g.faturamento_bruto += Number(r.faturamento_bruto || 0);
      g.lucro += Number(r.lucro || 0);
      g.cliques += Number(r.cliques || 0);
      g.impressoes_gam += Number(r.impressoes_gam || 0);
      g.resultado += Number(r.resultado || 0);
      g.orcamento_total = Math.max(g.orcamento_total, Number(r.orcamento_total || 0));

      const cliques = Number(r.cliques || 0);
      const imps = Number(r.impressoes_gam || 0);
      if ((r.cpc || 0) > 0 && cliques > 0) { g._cpcSum += r.cpc * cliques; g._cpcW += cliques; }
      if ((r.ctr || 0) > 0 && cliques > 0) { g._ctrSum += r.ctr * cliques; g._ctrW += cliques; }
      if ((r.ecpm || 0) > 0 && imps > 0) { g._ecpmSum += r.ecpm * imps; g._ecpmW += imps; }
      if ((r.rps || 0) > 0 && imps > 0) { g._rpsSum += r.rps * imps; g._rpsW += imps; }

      // Override previsão from most recent row
      if (Number(r.previsao_impressoes || 0) > 0) {
        g.previsao_impressoes = Number(r.previsao_impressoes);
        g.previsao_faturamento_real = Number(r.previsao_faturamento_real || 0);
        g.previsao_lucro = Number(r.previsao_lucro || 0);
        g.previsao_roas = Number(r.previsao_roas || 0);
      }
    }

    const aggregated = Object.values(utmMap).map(g => ({
      ad_utm: g.ad_utm,
      tipo: g.tipo,
      dominio: g.dominio,
      campanha_meta: g.campanha_meta,
      pais_sigla: g.pais_sigla,
      pais_nome: g.pais_nome,
      valor_gasto: +g.valor_gasto.toFixed(2),
      faturamento_real: +g.faturamento_real.toFixed(2),
      lucro: +g.lucro.toFixed(2),
      roas: g.valor_gasto > 0 ? +(g.faturamento_real / g.valor_gasto).toFixed(4) : 0,
      cpc: g._cpcW > 0 ? +(g._cpcSum / g._cpcW).toFixed(4) : 0,
      ctr: g._ctrW > 0 ? +(g._ctrSum / g._ctrW).toFixed(2) : 0,
      custo_resultado: g.resultado > 0 ? +(g.valor_gasto / g.resultado).toFixed(2) : 0,
      resultado: g.resultado,
      impressoes_gam: g.impressoes_gam,
      ecpm: g._ecpmW > 0 ? +(g._ecpmSum / g._ecpmW).toFixed(2) : 0,
      rps: g._rpsW > 0 ? +(g._rpsSum / g._rpsW).toFixed(4) : 0,
      orcamento_total: +g.orcamento_total.toFixed(2),
      previsao_impressoes: g.previsao_impressoes,
      previsao_faturamento_real: +g.previsao_faturamento_real.toFixed(2),
      previsao_lucro: +g.previsao_lucro.toFixed(2),
      previsao_roas: +g.previsao_roas.toFixed(4),
    })).sort((a, b) => b.valor_gasto - a.valor_gasto);

    // Summary KPIs
    const kpis = aggregated.reduce((acc, r) => {
      acc.faturamento += r.faturamento_real;
      acc.investimento += r.valor_gasto;
      acc.lucro += r.lucro;
      acc.impressoes += r.impressoes_gam;
      acc.cliques += r.resultado;
      return acc;
    }, { faturamento: 0, investimento: 0, lucro: 0, impressoes: 0, cliques: 0 });
    kpis.roi = kpis.investimento > 0 ? kpis.lucro / kpis.investimento * 100 : 0;
    kpis.roas = kpis.investimento > 0 ? kpis.faturamento / kpis.investimento : 0;

    res.json({ kpis, rows: aggregated });
  } catch (err) {
    console.error('[dashboard]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
