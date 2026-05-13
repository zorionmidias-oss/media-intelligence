'use strict';
const supabase = require('../../../lib/supabase');
const { fetchGAMHourly, fetchGAMUtmCampaigns, fetchGAMUtmSources } = require('../../../lib/gam');

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

    let gamQ = supabase
      .from('blocos_anuncio')
      .select('nome_bloco,impressoes,total_clicks,receita_total,ecpm_medio,taxa_correspondencia_programatica')
      .gte('data', df)
      .lte('data', dt);
    if (domainId) gamQ = gamQ.eq('dominio_id', domainId);

    let adsQ = supabase
      .from('ads_consolidados')
      .select('viewability,impressoes_gam,cpc_gam,ctr_gam,cliques_gam')
      .gte('data', df)
      .lte('data', dt);
    if (domainId) adsQ = adsQ.eq('dominio_id', domainId);

    const opts = { since: df, until: dt, domain: domain && domain !== 'all' ? domain : undefined };

    const [
      { data: rows },
      { data: adsRows },
      hourly,
      utmCampaigns,
      utmSources,
    ] = await Promise.all([
      gamQ,
      adsQ,
      fetchGAMHourly(opts),
      fetchGAMUtmCampaigns(opts),
      fetchGAMUtmSources(opts),
    ]);

    let totImps = 0, totRev = 0, totClicks = 0;
    let _ecpmWtSum = 0, _ecpmWt = 0;
    let _pmrWtSum = 0, _pmrWt = 0;
    const adUnitMap = {};

    for (const r of rows || []) {
      const imp = Number(r.impressoes || 0);
      const rev = Number(r.receita_total || 0);
      const clk = Number(r.total_clicks || 0);
      const em = Number(r.ecpm_medio || 0);
      const pmr = Number(r.taxa_correspondencia_programatica || 0);

      totImps += imp;
      totRev += rev;
      totClicks += clk;
      if (imp > 0 && em > 0) { _ecpmWtSum += em * imp; _ecpmWt += imp; }
      if (imp > 0) { _pmrWtSum += pmr * imp; _pmrWt += imp; }

      const k = r.nome_bloco;
      if (!adUnitMap[k]) adUnitMap[k] = { name: k, impressions: 0, revenue: 0, clicks: 0, taxaProgramatica: 0, _n: 0 };
      adUnitMap[k].impressions += imp;
      adUnitMap[k].revenue += rev;
      adUnitMap[k].clicks += clk;
      adUnitMap[k].taxaProgramatica += pmr;
      adUnitMap[k]._n++;
    }

    let _viewWtSum = 0, _viewWt = 0;
    let _cpcGamWtSum = 0, _cpcGamWt = 0;
    let _cliquesGamTotal = 0, _impGamForCtr = 0;
    for (const r of adsRows || []) {
      const vw = Number(r.viewability || 0);
      const im = Number(r.impressoes_gam || 0);
      const cpcG = Number(r.cpc_gam || 0);
      const clG = Number(r.cliques_gam || 0);
      if (vw > 0 && im > 0) { _viewWtSum += vw * im; _viewWt += im; }
      if (cpcG > 0 && clG > 0) { _cpcGamWtSum += cpcG * clG; _cpcGamWt += clG; }
      _cliquesGamTotal += clG;
      _impGamForCtr += im;
    }

    const ecpm = _ecpmWt > 0 ? _ecpmWtSum / _ecpmWt : 0;
    const pmr = _pmrWt > 0 ? _pmrWtSum / _pmrWt : 0;
    const ctr = totImps > 0 ? (totClicks / totImps) * 100 : 0;
    const rps = totImps > 0 ? totRev / totImps : 0;
    const viewability = _viewWt > 0 ? _viewWtSum / _viewWt : 0;
    const cpc_gam = _cpcGamWt > 0 ? _cpcGamWtSum / _cpcGamWt : 0;
    const ctr_gam = _impGamForCtr > 0 ? (_cliquesGamTotal / _impGamForCtr) * 100 : 0;

    const adUnits = Object.values(adUnitMap).map(u => ({
      name: u.name,
      impressions: u.impressions,
      revenue: u.revenue,
      clicks: u.clicks,
      ecpm: u.impressions > 0 ? +(u.revenue / u.impressions * 1000).toFixed(2) : 0,
      taxaProgramatica: u._n > 0 ? +(u.taxaProgramatica / u._n).toFixed(2) : 0,
    })).sort((a, b) => b.impressions - a.impressions);

    res.json({
      kpis: {
        ecpm: +ecpm.toFixed(2),
        rps: +rps.toFixed(4),
        taxaProgramatica: +pmr.toFixed(2),
        viewability: +viewability.toFixed(2),
        cpc: +cpc_gam.toFixed(4),
        ctr: +ctr_gam.toFixed(2),
        cliques_gam: _cliquesGamTotal,
        faturamento: +totRev.toFixed(2),
        impressions: totImps,
      },
      adUnits,
      advertisers: [],
      hourly,
      utmCampaigns,
      topUtmSource: utmSources.slice(0, 3),
    });
  } catch (err) {
    console.error('[reports-gam]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
