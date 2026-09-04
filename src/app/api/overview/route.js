'use strict';
const supabase = require('../../../lib/supabase');
const { getUSDtoBRL } = require('../../../lib/gam');
const { fetchAll } = require('../../../lib/fetchAll');
const { hojeBR, diasAtrasBR, addDiasISO } = require('../../../lib/datas');
const METRICAS = require('../../../lib/metricas');

// Progresso das metas — recebe as linhas de `metas` já buscadas (em paralelo com o
// restante), então só calcula (síncrono). Antes fazia a própria query no fim do
// handler, em série depois de tudo — latência à toa na tela inicial.
function computeMetasProgresso(metasRows, totFat, totSpend, totLucro, roi) {
  try {
    const byTipo = {};
    for (const m of metasRows || []) byTipo[m.tipo] = m;
    const prog = (atual, meta) => meta > 0 ? +((atual / meta) * 100).toFixed(1) : null;
    return {
      faturamento: byTipo.faturamento_diario
        ? { id: byTipo.faturamento_diario.id, meta: +byTipo.faturamento_diario.valor, atual: +totFat.toFixed(2), percentual: prog(totFat, +byTipo.faturamento_diario.valor) }
        : null,
      investimento: byTipo.investimento_diario
        ? { id: byTipo.investimento_diario.id, meta: +byTipo.investimento_diario.valor, atual: +totSpend.toFixed(2), percentual: prog(totSpend, +byTipo.investimento_diario.valor) }
        : null,
      lucro: byTipo.lucro_diario
        ? { id: byTipo.lucro_diario.id, meta: +byTipo.lucro_diario.valor, atual: +totLucro.toFixed(2), percentual: prog(totLucro, +byTipo.lucro_diario.valor) }
        : null,
      roas: byTipo.roas_diario
        ? { id: byTipo.roas_diario.id, meta: +byTipo.roas_diario.valor, atual: +roi, percentual: prog(roi, +byTipo.roas_diario.valor) }
        : null,
    };
  } catch { return {}; }
}

async function handler(req, res) {
  try {
    const { since, until, domain } = req.query;
    // Datas do negócio no fuso BR — "hoje" UTC vira amanhã a partir das 21h BRT
    const df = since || diasAtrasBR(30);
    const dt = until || hojeBR();

    let domainId = null;
    if (domain && domain !== 'all') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', domain).maybeSingle();
      domainId = d?.id || null;
    }

    // Previous period for comparison
    const dias = Math.round((new Date(dt) - new Date(df)) / 86400000) + 1;
    const prevDf = addDiasISO(df, -dias);
    const prevDt = addDiasISO(df, -1);

    // Task 14: janela do trend[] (gráficos hero/Performance por dia/sparklines) é
    // SEMPRE os últimos 30 dias, desacoplada do since/until que define os KPIs —
    // trocar o período do calendário não deve mexer nos gráficos.
    const trendDf = diasAtrasBR(30);
    const trendDt = hojeBR();

    // Fábricas de query: fetchAll pagina além do corte de 1000 linhas do PostgREST
    // (junho tinha 1.215 linhas de ads → investimento subcontado → ROI 117% falso)
    const restrito = Array.isArray(req.allowedDominios)
      ? (req.allowedDominios.length ? req.allowedDominios : [-1]) : null;

    const adsQ = () => {
      let q = supabase
        .from('ads_consolidados')
        .select('data,ad_utm,campanha_meta,tipo,dominio_id,valor_gasto,faturamento_real,lucro,cliques,impressoes_gam,resultado,sessoes_meta,cpc,ctr,ecpm,rps,viewability,orcamento_total,previsao_faturamento_real,previsao_lucro,dominios(nome)')
        .gte('data', df).lte('data', dt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      if (restrito) q = q.in('dominio_id', restrito);
      return q;
    };
    // blocos_anuncio = source of truth for GAM revenue (has more historical data)
    const gamQ = () => {
      let q = supabase
        .from('blocos_anuncio')
        .select('data,nome_bloco,impressoes,total_clicks,receita_total,ecpm_medio,taxa_correspondencia_programatica')
        .gte('data', df).lte('data', dt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      if (restrito) q = q.in('dominio_id', restrito);
      return q;
    };
    const prevAdsQ = () => {
      let q = supabase
        .from('ads_consolidados')
        // Task 13: sessoes_meta/resultado adicionados para comparativo de rps/custo_result/sessao_lead
        .select('ad_utm,valor_gasto,faturamento_real,sessoes_meta,resultado')
        .gte('data', prevDf).lte('data', prevDt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      return q;
    };
    const prevGamQ = () => {
      let q = supabase
        .from('blocos_anuncio')
        .select('impressoes,total_clicks,ecpm_medio')
        .gte('data', prevDf).lte('data', prevDt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      return q;
    };
    // Task 14: queries dedicadas do trend fixo (30d) — independentes de since/until.
    const trendAdsQ = () => {
      let q = supabase
        .from('ads_consolidados')
        .select('data,valor_gasto,sessoes_meta,resultado')
        .gte('data', trendDf).lte('data', trendDt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      if (restrito) q = q.in('dominio_id', restrito);
      return q;
    };
    const trendGamQ = () => {
      let q = supabase
        .from('blocos_anuncio')
        .select('data,impressoes,receita_total,ecpm_medio')
        .gte('data', trendDf).lte('data', trendDt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      if (restrito) q = q.in('dominio_id', restrito);
      return q;
    };

    // Auxiliares independentes da agregação — buscados EM PARALELO com os 6 fetchAll
    // (antes eram 3 awaits em série no fim: câmbio, previsão de hoje e metas).
    const todayStr = hojeBR();
    const inRange = todayStr >= df && todayStr <= dt;
    const usdToBrlP = getUSDtoBRL();
    const metasP = supabase.from('metas').select('*').eq('ativa', true).is('dominio_id', null);
    let previsaoRowsP = Promise.resolve({ data: [] });
    if (inRange) {
      let pq = supabase
        .from('ads_consolidados')
        .select('orcamento_total,valor_gasto,resultado,impressoes_gam,ecpm,account_id,updated_at')
        .eq('data', todayStr);
      if (domainId) pq = pq.eq('dominio_id', domainId);
      previsaoRowsP = pq;
    }

    const [
      { data: ads, error: adsErr }, { data: gam }, { data: prevAds }, { data: prevGam },
      { data: trendAds }, { data: trendGam },
      usdToBrl, { data: metasRows }, { data: previsaoRows },
    ] = await Promise.all([
      fetchAll(adsQ), fetchAll(gamQ), fetchAll(prevAdsQ), fetchAll(prevGamQ),
      fetchAll(trendAdsQ), fetchAll(trendGamQ),
      usdToBrlP, metasP, previsaoRowsP,
    ]);
    if (adsErr) return res.status(500).json({ error: adsErr.message });

    // ─── Aggregate ads_consolidados (Meta spend + UTM attribution) ───
    // Task 14: invByDay/sessoesByDay/resultsByDay (usados só pelo trend) saíram
    // daqui — o trend agora vem de trendAds/trendGam (janela fixa 30d), não deste
    // loop (janela since/until dos KPIs). Ver aggregation de trendAds mais abaixo.
    const utmMap = {};
    let totSpend = 0, totResults = 0, totClicks = 0, totSessoes = 0;
    let _viewWtSum = 0, _viewWt = 0;

    for (const r of ads || []) {
      const key = `${r.dominio_id}|${r.ad_utm}`;
      if (!utmMap[key]) {
        utmMap[key] = {
          ad_utm: r.ad_utm,
          campanha_meta: r.campanha_meta || r.ad_utm,
          domain: r.dominios?.nome || null,
          tipo: r.tipo,
          spend: 0, impressions: 0, clicks: 0, results: 0, faturamento: 0, lucro: 0,
          _cpcSum: 0, _cpcW: 0, _ctrSum: 0, _ctrW: 0, _ecpmSum: 0, _ecpmW: 0,
        };
      }
      const u = utmMap[key];
      u.spend += Number(r.valor_gasto || 0);
      u.impressions += Number(r.impressoes_gam || 0);
      u.clicks += Number(r.cliques || 0);
      u.results += Number(r.resultado || 0);
      u.faturamento += Number(r.faturamento_real || 0);
      u.lucro += Number(r.lucro || 0);
      const cl = Number(r.cliques || 0);
      const im = Number(r.impressoes_gam || 0);
      if ((r.cpc || 0) > 0 && cl > 0) { u._cpcSum += r.cpc * cl; u._cpcW += cl; }
      if ((r.ctr || 0) > 0 && cl > 0) { u._ctrSum += r.ctr * cl; u._ctrW += cl; }
      if ((r.ecpm || 0) > 0 && im > 0) { u._ecpmSum += r.ecpm * im; u._ecpmW += im; }
      const vw = Number(r.viewability || 0);
      if (vw > 0 && im > 0) { _viewWtSum += vw * im; _viewWt += im; }

      totSpend += Number(r.valor_gasto || 0);
      totResults += Number(r.resultado || 0);
      totClicks += Number(r.cliques || 0);
      totSessoes += Number(r.sessoes_meta || 0);
    }

    // ─── Aggregate blocos_anuncio (GAM: ecpm, impressions, viewability only) ───
    let gamImps = 0, gamClicks = 0;
    let _ecpmWtSum = 0, _ecpmWt = 0, _pmrWtSum = 0, _pmrWt = 0;
    const adUnitMap = {};

    for (const r of gam || []) {
      const revBruto = Number(r.receita_total || 0);

      const imp = Number(r.impressoes || 0);
      const clk = Number(r.total_clicks || 0);
      const em = Number(r.ecpm_medio || 0);
      const pmr = Number(r.taxa_correspondencia_programatica || 0);
      gamImps += imp;
      gamClicks += clk;
      if (imp > 0 && em > 0) { _ecpmWtSum += em * imp; _ecpmWt += imp; }
      if (imp > 0) { _pmrWtSum += pmr * imp; _pmrWt += imp; }

      const bk = r.nome_bloco;
      if (!adUnitMap[bk]) adUnitMap[bk] = { name: bk, impressions: 0, revenue: 0, clicks: 0, taxaProgramatica: 0, _n: 0 };
      adUnitMap[bk].impressions += imp;
      adUnitMap[bk].revenue += revBruto;
      adUnitMap[bk].clicks += clk;
      adUnitMap[bk].taxaProgramatica += pmr;
      adUnitMap[bk]._n++;
    }

    // Faturamento real = receita bruta GAM total * 0.9
    // blocos_anuncio.receita_total já está em BRL (convertido no sync)
    const totFatBruto = (gam || []).reduce((s, r) => s + Number(r.receita_total || 0), 0);
    const totFat = totFatBruto * 0.9;
    const totLucro = totFat - totSpend;
    const ecpm = _ecpmWt > 0 ? _ecpmWtSum / _ecpmWt : 0;
    const taxaProgramatica = _pmrWt > 0 ? _pmrWtSum / _pmrWt : 0;
    const gamCtr = gamImps > 0 ? (gamClicks / gamImps) * 100 : 0;
    const rps = gamImps > 0 ? totFat / gamImps : 0;
    const viewability = _viewWt > 0 ? _viewWtSum / _viewWt : 0;
    // PAR = impressões GAM ÷ sessões (view_content Meta) — anúncios exibidos por
    // sessão. Usa gamImps (mesma base da KPI "Impressões") ÷ sessões atribuídas.
    const par = METRICAS.par({ impressoes: gamImps, sessoes: totSessoes });

    // ─── Trend (Task 14: janela FIXA de 30 dias, desacoplada do since/until dos KPIs) ───
    // Mesma agregação/fórmulas de antes (blocos GAM ×0.9 — mesma fonte do KPI —
    // + investimento Meta por dia), só que sourced de trendAds/trendGam (30d fixos)
    // em vez de ads/gam (janela since/until).
    const trendInvByDay = {};
    const trendSessoesByDay = {};
    const trendResultsByDay = {};
    for (const r of trendAds || []) {
      const day = r.data;
      trendInvByDay[day] = (trendInvByDay[day] || 0) + Number(r.valor_gasto || 0);
      trendSessoesByDay[day] = (trendSessoesByDay[day] || 0) + Number(r.sessoes_meta || 0);
      trendResultsByDay[day] = (trendResultsByDay[day] || 0) + Number(r.resultado || 0);
    }
    const trendFatBlocosByDay = {}; // blocos_anuncio ×0.9 — mesma fonte do KPI faturamento
    const trendEcpmByDay = {};
    const trendImpsByDay = {};
    for (const r of trendGam || []) {
      const day = r.data;
      const revBruto = Number(r.receita_total || 0);
      trendFatBlocosByDay[day] = (trendFatBlocosByDay[day] || 0) + revBruto * 0.9;
      const imp = Number(r.impressoes || 0);
      const em = Number(r.ecpm_medio || 0);
      trendImpsByDay[day] = (trendImpsByDay[day] || 0) + imp;
      if (imp > 0 && em > 0) {
        if (!trendEcpmByDay[day]) trendEcpmByDay[day] = { s: 0, w: 0 };
        trendEcpmByDay[day].s += em * imp;
        trendEcpmByDay[day].w += imp;
      }
    }

    const allDays = new Set([...Object.keys(trendInvByDay), ...Object.keys(trendFatBlocosByDay)]);
    const trend = [...allDays].sort().map(d => {
      const fat = trendFatBlocosByDay[d] || 0;
      const inv = trendInvByDay[d] || 0;
      const ed  = trendEcpmByDay[d];
      // Task 11 — sparklines dos 6 cards menores: mesmas fórmulas de src/lib/metricas.js
      // (rps, par) e do Overview.jsx (custo_result, sessao_lead), só que por dia em vez
      // de somado no período. faturamento_real já é líquido (×0.9 no sync) — não reaplicar.
      const ses = trendSessoesByDay[d] || 0;
      const res = trendResultsByDay[d] || 0;
      const imp = trendImpsByDay[d] || 0;
      return {
        date: d,
        faturamento:  +fat.toFixed(2),
        investimento: +inv.toFixed(2),
        lucro:        +(fat - inv).toFixed(2),
        ecpm:         ed?.w > 0 ? +(ed.s / ed.w).toFixed(2) : 0,
        roas:         inv > 0   ? +(fat / inv).toFixed(4)   : 0,
        rps:          ses > 0 ? +(fat / ses).toFixed(4) : 0,
        impressions:  imp,
        custo_result: res > 0 ? +(inv / res).toFixed(2) : 0,
        par:          ses > 0 ? +(imp / ses).toFixed(2) : 0,
        sessao_lead:  res > 0 ? +(ses / res).toFixed(2) : 0,
      };
    });

    // ─── UTM list — sorted by lucro ───
    const allUTMs = Object.values(utmMap).map(u => ({
      ad_utm: u.ad_utm,
      name: u.ad_utm,       // use ad_utm as name → prevents creative-grouping in renderTopCamps
      campaignName: null,    // prevents extractCreative in groupAdsetsByCreative
      domain: u.domain,
      tipo: u.tipo,
      spend: u.spend,
      impressions: u.impressions,
      clicks: u.clicks,
      results: u.results,
      cpc: u._cpcW > 0 ? +(u._cpcSum / u._cpcW).toFixed(4) : 0,
      ctr: u._ctrW > 0 ? +(u._ctrSum / u._ctrW).toFixed(2) : 0,
      costPerResult: u.results > 0 ? +(u.spend / u.results).toFixed(2) : 0,
      faturado: u.faturamento,
      lucro: u.lucro,
      roi: u.spend > 0 ? +((u.lucro / u.spend) * 100).toFixed(2) : 0,
      roas: u.spend > 0 ? +(u.faturamento / u.spend).toFixed(4) : 0,
      status: 'ACTIVE',
    })).sort((a, b) => b.lucro - a.lucro);

    // Top 4 funnels = top 4 UTMs by lucro
    const topFunnels = allUTMs.slice(0, 4).map(u => ({
      name: u.ad_utm,
      investimento: u.spend,
      spend: u.spend,
      faturamento: u.faturado,
      lucro: u.lucro,
      domain: u.domain,
      roi: u.roi,
      roas: u.roas,
    }));

    // gamUTMMap for creative cross-referencing
    const gamUTMMap = {};
    for (const u of Object.values(utmMap)) {
      gamUTMMap[u.ad_utm] = {
        revenue: u.faturamento,
        ecpm: u._ecpmW > 0 ? +(u._ecpmSum / u._ecpmW).toFixed(2) : 0,
      };
    }

    const adUnits = Object.values(adUnitMap).map(u => ({
      name: u.name,
      impressions: u.impressions,
      revenue: u.revenue,
      clicks: u.clicks,
      ecpm: u.impressions > 0 ? +(u.revenue / u.impressions * 1000).toFixed(2) : 0,
      taxaProgramatica: u._n > 0 ? +(u.taxaProgramatica / u._n).toFixed(2) : 0,
    })).sort((a, b) => b.impressions - a.impressions);

    const utmTop3 = [...allUTMs].sort((a, b) => b.faturado - a.faturado).slice(0, 3)
      .map(u => ({ name: u.ad_utm, revenue: u.faturado }));

    const roi = totSpend > 0 ? +((totLucro / totSpend) * 100).toFixed(2) : 0;

    // ─── Previous period GAM aggregation ────────────────────────────────────
    let prevGamImps = 0, prevGamClicks = 0;
    let _prevEcpmWtSum = 0, _prevEcpmWt = 0;
    for (const r of prevGam || []) {
      const imp = Number(r.impressoes || 0);
      const clk = Number(r.total_clicks || 0);
      const em  = Number(r.ecpm_medio || 0);
      prevGamImps  += imp;
      prevGamClicks += clk;
      if (imp > 0 && em > 0) { _prevEcpmWtSum += em * imp; _prevEcpmWt += imp; }
    }
    const prevEcpm   = _prevEcpmWt > 0 ? _prevEcpmWtSum / _prevEcpmWt : 0;
    const prevGamCtr = prevGamImps > 0 ? (prevGamClicks / prevGamImps) * 100 : 0;

    // ─── Previous period comparison ──────────────────────────────────────────
    const prevUtmMap = {};
    // Task 13: totais do período anterior p/ os 4 comparativos que faltavam
    // (rps, custo_result, par, sessao_lead) — mesma fonte (prevAds) das outras.
    let prevSessoes = 0, prevResults = 0;
    for (const r of prevAds || []) {
      const k = r.ad_utm;
      if (!prevUtmMap[k]) prevUtmMap[k] = { spend: 0, fat: 0 };
      prevUtmMap[k].spend += Number(r.valor_gasto || 0);
      prevUtmMap[k].fat   += Number(r.faturamento_real || 0);
      prevSessoes += Number(r.sessoes_meta || 0);
      prevResults += Number(r.resultado || 0);
    }
    const prevTotSpend = Object.values(prevUtmMap).reduce((s, v) => s + v.spend, 0);
    const prevTotFat   = Object.values(prevUtmMap).reduce((s, v) => s + v.fat,   0);
    const prevTotLucro = prevTotFat - prevTotSpend;
    const prevRoi      = prevTotSpend > 0 ? (prevTotLucro / prevTotSpend) * 100 : 0;
    const varPct = (atual, ant) => {
      if (!ant || ant === 0) return null;
      return +((atual - ant) / Math.abs(ant) * 100).toFixed(1);
    };
    // Task 13: as mesmas fórmulas do trend diário (linhas ~208-222) e de
    // src/lib/metricas.js, somadas no período inteiro (atual e anterior) em vez
    // de por dia — base dos 4 comparativos que faltavam nos cards menores.
    const rpsCur          = totSessoes > 0 ? totFat / totSessoes : 0;
    const rpsPrev         = prevSessoes > 0 ? prevTotFat / prevSessoes : 0;
    const custoResultCur  = totResults > 0 ? totSpend / totResults : 0;
    const custoResultPrev = prevResults > 0 ? prevTotSpend / prevResults : 0;
    const parCur          = totSessoes > 0 ? gamImps / totSessoes : 0;
    const parPrev         = prevSessoes > 0 ? prevGamImps / prevSessoes : 0;
    const sessaoLeadCur   = totResults > 0 ? totSessoes / totResults : 0;
    const sessaoLeadPrev  = prevResults > 0 ? prevSessoes / prevResults : 0;
    const comparacao = {
      periodo_anterior: { since: prevDf, until: prevDt },
      faturamento:  varPct(totFat,    prevTotFat),
      investimento: varPct(totSpend,  prevTotSpend),
      lucro:        varPct(totLucro,  prevTotLucro),
      roi:          prevRoi !== 0 ? +(roi - prevRoi).toFixed(1) : null,
      gamEcpm:       prevGamImps > 0 ? varPct(ecpm,    prevEcpm)   : null,
      gamImpressions: prevGamImps > 0 ? varPct(gamImps, prevGamImps) : null,
      gamCtr:        prevGamImps > 0 ? varPct(gamCtr,  prevGamCtr) : null,
      rps:          varPct(rpsCur, rpsPrev),
      custoResult:  varPct(custoResultCur, custoResultPrev),
      par:          varPct(parCur, parPrev),
      sessaoLead:   varPct(sessaoLeadCur, sessaoLeadPrev),
      porUtm: Object.fromEntries(allUTMs.map(u => {
        const p = prevUtmMap[u.ad_utm] || { spend: 0, fat: 0 };
        return [u.ad_utm, {
          faturamento:  varPct(u.faturado, p.fat),
          investimento: varPct(u.spend,    p.spend),
        }];
      })),
    };

    // Previsão de hoje — usa as linhas já buscadas em paralelo (previsaoRows).
    let previsao = null;
    let delayHours = 0;
    if (inRange) {
      const dados = previsaoRows || [];

      // Atraso de dados: a conta mais defasada define o delay (sync de uma conta pode
      // falhar e deixar o gasto congelado enquanto as outras seguem atualizando)
      const lastByAcc = {};
      for (const r of dados) {
        if (!r.updated_at) continue;
        const iso = /Z$|[+-]\d{2}:?\d{2}$/.test(r.updated_at) ? r.updated_at : r.updated_at + 'Z';
        const ts = Date.parse(iso);
        if (!Number.isFinite(ts)) continue;
        const acc = r.account_id || '_';
        if (ts > (lastByAcc[acc] || 0)) lastByAcc[acc] = ts;
      }
      const stamps = Object.values(lastByAcc);
      if (stamps.length > 0) {
        const h = (Date.now() - Math.min(...stamps)) / 3600000;
        // < 1h é cadência normal de sync — só sinalizar atraso real
        delayHours = h >= 1 ? +h.toFixed(1) : 0;
      }
      if (dados.length > 0) {
        const orcamento_total    = dados.reduce((s, r) => s + Number(r.orcamento_total || 0), 0);
        const gasto_atual        = dados.reduce((s, r) => s + Number(r.valor_gasto     || 0), 0);
        const resultados_total   = dados.reduce((s, r) => s + Number(r.resultado       || 0), 0);
        const impressoes_total   = dados.reduce((s, r) => s + Number(r.impressoes_gam  || 0), 0);
        let ecpmWtS = 0, ecpmWtW = 0;
        for (const r of dados) {
          const imp = Number(r.impressoes_gam || 0);
          const em  = Number(r.ecpm          || 0);
          if (imp > 0 && em > 0) { ecpmWtS += em * imp; ecpmWtW += imp; }
        }
        const ecpm_atual          = ecpmWtW > 0 ? ecpmWtS / ecpmWtW : 0;
        const cpa_atual           = resultados_total > 0 ? gasto_atual / resultados_total : 0;
        const proporcao           = resultados_total > 0 ? impressoes_total / resultados_total : 0;
        const custo_por_impressao = ecpm_atual / 1000;
        const resultados_previstos = cpa_atual > 0 ? orcamento_total / cpa_atual : 0;
        const impressoes_previstas = resultados_previstos * proporcao;
        const fat_bruto_previsto  = impressoes_previstas * custo_por_impressao;
        const fat_real_previsto   = fat_bruto_previsto * 0.9;
        const lucro_previsto      = fat_real_previsto - orcamento_total;
        const roas_previsto       = orcamento_total > 0 ? fat_real_previsto / orcamento_total : 0;
        previsao = {
          orcamento_total:            +orcamento_total.toFixed(2),
          gasto_atual:                +gasto_atual.toFixed(2),
          orcamento_restante:         +(orcamento_total - gasto_atual).toFixed(2),
          cpa_atual:                  +cpa_atual.toFixed(4),
          ecpm_atual:                 +ecpm_atual.toFixed(2),
          impressoes_gam_atual:       impressoes_total,
          resultados_meta_atual:      resultados_total,
          proporcao_imp_resultado:    +proporcao.toFixed(2),
          custo_por_impressao:        +custo_por_impressao.toFixed(6),
          resultados_previstos:       Math.round(resultados_previstos),
          impressoes_previstas:       Math.round(impressoes_previstas),
          faturamento_real_previsto:  +fat_real_previsto.toFixed(2),
          lucro_previsto:             +lucro_previsto.toFixed(2),
          roas_previsto:              +roas_previsto.toFixed(4),
          utms_total:                 dados.length,
        };
      }
    }

    res.json({
      kpis: {
        faturamento: +totFat.toFixed(2),
        faturamento_bruto: +totFatBruto.toFixed(2),
        investimento: +totSpend.toFixed(2),
        lucro: +totLucro.toFixed(2),
        roi,
        results: totResults,
        impressions: gamImps,
        sessoes: totSessoes,
        par,
        ctr: +gamCtr.toFixed(2),
        ecpm: +ecpm.toFixed(2),
        rps: +rps.toFixed(4),
        viewability: +viewability.toFixed(2),
        taxaProgramatica: +taxaProgramatica.toFixed(2),
        cpc: totSpend > 0 && totClicks > 0 ? +(totSpend / totClicks).toFixed(4) : 0,
        cpaIdeal: rps / 1000,
        delayHours,
        usdToBrl,
        roas: totSpend > 0 ? +(totFat / totSpend).toFixed(4) : 0,
      },
      trend,
      topFunnels,
      topCampaigns: [...allUTMs].sort((a, b) => b.roi - a.roi),
      adsets: allUTMs,
      adUnits,
      topAdvertisers: [],
      utmCampaignTop3: utmTop3,
      utmSourceTop3: [],
      gamUTMMap,
      networks: [],
      previsao,
      metas_progresso: computeMetasProgresso(metasRows, totFat, totSpend, totLucro, roi),
      comparacao,
    });
  } catch (err) {
    console.error('[overview]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
