'use strict';
const supabase = require('../../../lib/supabase');
const { getUSDtoBRL } = require('../../../lib/gam');

async function getMetasProgresso(totFat, totSpend, totLucro, roi) {
  try {
    const { data } = await supabase.from('metas').select('*').eq('ativa', true).is('dominio_id', null);
    const byTipo = {};
    for (const m of data || []) byTipo[m.tipo] = m;
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
    const now = new Date();
    const df = since || new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const dt = until || now.toISOString().slice(0, 10);

    let domainId = null;
    if (domain && domain !== 'all') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', domain).maybeSingle();
      domainId = d?.id || null;
    }

    // Previous period for comparison
    const dias = Math.round((new Date(dt) - new Date(df)) / 86400000) + 1;
    const prevUntilDate = new Date(df); prevUntilDate.setDate(prevUntilDate.getDate() - 1);
    const prevSinceDate = new Date(df); prevSinceDate.setDate(prevSinceDate.getDate() - dias);
    const prevDf = prevSinceDate.toISOString().slice(0, 10);
    const prevDt = prevUntilDate.toISOString().slice(0, 10);

    let adsQ = supabase
      .from('ads_consolidados')
      .select('data,ad_utm,campanha_meta,tipo,dominio_id,valor_gasto,faturamento_real,lucro,cliques,impressoes_gam,resultado,cpc,ctr,ecpm,rps,viewability,orcamento_total,previsao_faturamento_real,previsao_lucro,dominios(nome)')
      .gte('data', df).lte('data', dt);
    if (domainId) adsQ = adsQ.eq('dominio_id', domainId);

    // blocos_anuncio = source of truth for GAM revenue (has more historical data)
    let gamQ = supabase
      .from('blocos_anuncio')
      .select('data,nome_bloco,impressoes,total_clicks,receita_total,ecpm_medio,taxa_correspondencia_programatica')
      .gte('data', df).lte('data', dt);
    if (domainId) gamQ = gamQ.eq('dominio_id', domainId);

    let prevAdsQ = supabase
      .from('ads_consolidados')
      .select('ad_utm,valor_gasto,faturamento_real')
      .gte('data', prevDf).lte('data', prevDt);
    if (domainId) prevAdsQ = prevAdsQ.eq('dominio_id', domainId);

    const [{ data: ads, error: adsErr }, { data: gam }, { data: prevAds }] = await Promise.all([adsQ, gamQ, prevAdsQ]);
    if (adsErr) return res.status(500).json({ error: adsErr.message });

    // ─── Aggregate ads_consolidados (Meta spend + UTM attribution) ───
    const invByDay = {};
    const fatByDay = {}; // from ads_consolidados.faturamento_real (0.9 applied by sync.js)
    const utmMap = {};
    let totSpend = 0, totResults = 0, totClicks = 0;
    let _viewWtSum = 0, _viewWt = 0;

    for (const r of ads || []) {
      const day = r.data;
      if (!invByDay[day]) invByDay[day] = 0;
      invByDay[day] += Number(r.valor_gasto || 0);
      if (!fatByDay[day]) fatByDay[day] = 0;
      fatByDay[day] += Number(r.faturamento_real || 0);

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
    }

    // ─── Aggregate blocos_anuncio (GAM: ecpm, impressions, viewability only) ───
    const ecpmByDay = {};
    let gamImps = 0, gamClicks = 0;
    let _ecpmWtSum = 0, _ecpmWt = 0, _pmrWtSum = 0, _pmrWt = 0;
    const adUnitMap = {};

    for (const r of gam || []) {
      const day = r.data;
      const revBruto = Number(r.receita_total || 0);

      const imp = Number(r.impressoes || 0);
      const clk = Number(r.total_clicks || 0);
      const em = Number(r.ecpm_medio || 0);
      const pmr = Number(r.taxa_correspondencia_programatica || 0);
      gamImps += imp;
      gamClicks += clk;
      if (imp > 0 && em > 0) {
        _ecpmWtSum += em * imp; _ecpmWt += imp;
        if (!ecpmByDay[day]) ecpmByDay[day] = { s: 0, w: 0 };
        ecpmByDay[day].s += em * imp; ecpmByDay[day].w += imp;
      }
      if (imp > 0) { _pmrWtSum += pmr * imp; _pmrWt += imp; }

      const bk = r.nome_bloco;
      if (!adUnitMap[bk]) adUnitMap[bk] = { name: bk, impressions: 0, revenue: 0, clicks: 0, taxaProgramatica: 0, _n: 0 };
      adUnitMap[bk].impressions += imp;
      adUnitMap[bk].revenue += revBruto;
      adUnitMap[bk].clicks += clk;
      adUnitMap[bk].taxaProgramatica += pmr;
      adUnitMap[bk]._n++;
    }

    // faturamento_real already stored net in ads_consolidados (0.9 applied in sync.js)
    const totFat = Object.values(utmMap).reduce((s, u) => s + u.faturamento, 0);
    const totLucro = totFat - totSpend;
    const ecpm = _ecpmWt > 0 ? _ecpmWtSum / _ecpmWt : 0;
    const taxaProgramatica = _pmrWt > 0 ? _pmrWtSum / _pmrWt : 0;
    const gamCtr = gamImps > 0 ? (gamClicks / gamImps) * 100 : 0;
    const rps = gamImps > 0 ? totFat / gamImps : 0;
    const viewability = _viewWt > 0 ? _viewWtSum / _viewWt : 0;

    // ─── Trend: merge daily faturamento (GAM) + investimento (Meta) ───
    const allDays = new Set([...Object.keys(invByDay), ...Object.keys(fatByDay)]);
    const trend = [...allDays].sort().map(d => {
      const fat = fatByDay[d] || 0;
      const inv = invByDay[d] || 0;
      const ed  = ecpmByDay[d];
      return {
        date: d,
        faturamento:  +fat.toFixed(2),
        investimento: +inv.toFixed(2),
        lucro:        +(fat - inv).toFixed(2),
        ecpm:         ed?.w > 0 ? +(ed.s / ed.w).toFixed(2) : 0,
        roas:         inv > 0   ? +(fat / inv).toFixed(4)   : 0,
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

    // ─── Previous period comparison ──────────────────────────────────────────
    const prevUtmMap = {};
    for (const r of prevAds || []) {
      const k = r.ad_utm;
      if (!prevUtmMap[k]) prevUtmMap[k] = { spend: 0, fat: 0 };
      prevUtmMap[k].spend += Number(r.valor_gasto || 0);
      prevUtmMap[k].fat   += Number(r.faturamento_real || 0);
    }
    const prevTotSpend = Object.values(prevUtmMap).reduce((s, v) => s + v.spend, 0);
    const prevTotFat   = Object.values(prevUtmMap).reduce((s, v) => s + v.fat,   0);
    const prevTotLucro = prevTotFat - prevTotSpend;
    const prevRoi      = prevTotSpend > 0 ? (prevTotLucro / prevTotSpend) * 100 : 0;
    const varPct = (atual, ant) => {
      if (!ant || ant === 0) return null;
      return +((atual - ant) / Math.abs(ant) * 100).toFixed(1);
    };
    const comparacao = {
      periodo_anterior: { since: prevDf, until: prevDt },
      faturamento:  { atual: +totFat.toFixed(2),    anterior: +prevTotFat.toFixed(2),    variacao: varPct(totFat,    prevTotFat) },
      investimento: { atual: +totSpend.toFixed(2),  anterior: +prevTotSpend.toFixed(2),  variacao: varPct(totSpend,  prevTotSpend) },
      lucro:        { atual: +totLucro.toFixed(2),  anterior: +prevTotLucro.toFixed(2),  variacao: varPct(totLucro,  prevTotLucro) },
      roi:          { atual: roi,                   anterior: +prevRoi.toFixed(2),        variacao: prevRoi !== 0 ? +(roi - prevRoi).toFixed(1) : null },
      porUtm: Object.fromEntries(allUTMs.map(u => {
        const p = prevUtmMap[u.ad_utm] || { spend: 0, fat: 0 };
        return [u.ad_utm, {
          faturamento:  { anterior: +p.fat.toFixed(2),   variacao: varPct(u.faturado, p.fat) },
          investimento: { anterior: +p.spend.toFixed(2), variacao: varPct(u.spend,    p.spend) },
        }];
      })),
    };

    // Previsão: query direta para hoje (respeita filtro de domínio; null se hoje não está no range)
    const todayStr = new Date().toISOString().slice(0, 10);
    let previsao = null;
    if (todayStr >= df && todayStr <= dt) {
      let prevQ = supabase
        .from('ads_consolidados')
        .select('orcamento_total,valor_gasto,resultado,impressoes_gam,ecpm')
        .eq('data', todayStr);
      if (domainId) prevQ = prevQ.eq('dominio_id', domainId);
      const { data: prevData } = await prevQ;
      const dados = prevData || [];
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
        investimento: +totSpend.toFixed(2),
        lucro: +totLucro.toFixed(2),
        roi,
        results: totResults,
        impressions: gamImps,
        ctr: +gamCtr.toFixed(2),
        ecpm: +ecpm.toFixed(2),
        rps: +rps.toFixed(4),
        viewability: +viewability.toFixed(2),
        taxaProgramatica: +taxaProgramatica.toFixed(2),
        cpc: totSpend > 0 && totClicks > 0 ? +(totSpend / totClicks).toFixed(4) : 0,
        cpaIdeal: rps / 1000,
        delayHours: 0,
        usdToBrl: await getUSDtoBRL(),
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
      metas_progresso: await getMetasProgresso(totFat, totSpend, totLucro, roi),
      comparacao,
    });
  } catch (err) {
    console.error('[overview]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
