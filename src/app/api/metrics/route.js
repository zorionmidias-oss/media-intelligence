'use strict';
const { hojeBR, diasAtrasBR } = require('../../../lib/datas');
const { fetchAllBMs } = require('../../../lib/meta');
const { fetchGAMReport, fetchGAMAdvertisers, discoverGAMNetworks, fetchGAMFunnelsByUTM } = require('../../../lib/gam');

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function cacheKey(q) {
  return JSON.stringify({ since: q.since, until: q.until, domain: q.domain || 'all' });
}

function defaultRange() {
  return { since: diasAtrasBR(30), until: hojeBR() };
}

function buildTrend(dailySpendMap, dailyRevenueMap, since, until) {
  const points = [];
  const start = new Date(since);
  const end = new Date(until);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    points.push({
      date: dateStr,
      faturamento: dailyRevenueMap[dateStr] || 0,
      investimento: dailySpendMap[dateStr] || 0,
    });
  }
  return points.slice(-30);
}

function buildUTMFunnels(campaigns, gamUTMMap) {
  const acc = {};
  for (const c of campaigns) {
    if (!c.utmCode) continue;
    const k = c.utmCode;
    if (!acc[k]) acc[k] = { name: k, domain: c.domain, investimento: 0, results: 0 };
    acc[k].investimento += c.spend || 0;
    acc[k].results += c.results || 0;
  }
  return Object.values(acc).map(f => {
    const gam = gamUTMMap[f.name] || {};
    const faturamento = gam.revenue || 0;
    const lucro = faturamento - f.investimento;
    const roi = f.investimento > 0 ? (lucro / f.investimento) * 100 : 0;
    return {
      ...f,
      faturamento,
      lucro,
      roi,
      ecpm: gam.ecpm || 0,
      ctr: gam.ctr || 0,
      roas: f.investimento > 0 ? faturamento / f.investimento : 0,
      spend: f.investimento,
    };
  });
}

function buildObjectiveFunnels(funnelAcc) {
  return Object.values(funnelAcc)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 4)
    .map(f => ({
      ...f,
      name: f.objective,
      domain: null,
      investimento: f.spend,
      faturamento: f.revenue || 0,
      lucro: (f.revenue || 0) - f.spend,
      roi: f.spend > 0 ? (((f.revenue || 0) - f.spend) / f.spend) * 100 : 0,
      ctr: f.impressions > 0 ? (f.clicks / f.impressions) * 100 : 0,
      costPerResult: f.results > 0 ? f.spend / f.results : 0,
      roas: f.spend > 0 ? (f.revenue || 0) / f.spend : 0,
    }));
}

async function handler(req, res) {
  try {
    const since = req.query.since || req.query.from;
    const until = req.query.until || req.query.to;
    const domainFilter = (req.query.domain && req.query.domain !== 'all') ? req.query.domain : null;
    const forceRefresh = req.query.forceRefresh === '1';

    const key = cacheKey({ since, until, domain: domainFilter });
    if (!forceRefresh && cache.has(key)) {
      const entry = cache.get(key);
      if (Date.now() - entry.timestamp < CACHE_TTL) {
        return res.json({ ...entry.data, cached: true });
      }
    }

    const dateRange = since && until ? { since, until } : defaultRange();

    // Phase 1: Meta BMs, GAM report, GAM advertisers, GAM networks — all in parallel
    const [bms, gamData, topAdvertisers, networks] = await Promise.all([
      fetchAllBMs(dateRange).catch(e => { console.error('[Meta]', e.message); return []; }),
      fetchGAMReport(dateRange).catch(e => { console.error('[GAM]', e.message); return null; }),
      fetchGAMAdvertisers(dateRange).catch(e => { console.error('[GAM adv]', e.message); return []; }),
      discoverGAMNetworks().catch(e => { console.error('[GAM networks]', e.message); return []; }),
    ]);

    // Phase 2: UTM funnels per network — parallel
    const netsForUTM = networks.length > 0 ? networks : [{ networkCode: null, domain: null }];
    const gamFunnelsByNet = await Promise.all(
      netsForUTM.map(n =>
        fetchGAMFunnelsByUTM(n.networkCode || null, dateRange)
          .then(result => ({
            campaigns: (result.campaigns || []).map(f => ({ ...f, networkDomain: n.domain || null })),
            sources: (result.sources || []).map(f => ({ ...f, networkDomain: n.domain || null })),
          }))
          .catch(e => { console.error('[GAM UTM]', e.message); return { campaigns: [], sources: [] }; })
      )
    );

    const allGamCampaigns = gamFunnelsByNet.flatMap(r => r.campaigns || []);
    const allGamSources = gamFunnelsByNet.flatMap(r => r.sources || []);

    const gamFunnels = domainFilter
      ? allGamCampaigns.filter(f => !f.networkDomain || f.networkDomain === domainFilter)
      : allGamCampaigns;
    const gamSources = domainFilter
      ? allGamSources.filter(f => !f.networkDomain || f.networkDomain === domainFilter)
      : allGamSources;

    // UTM Campaign top 3 and Source top 3 (by revenue)
    const utmCampaignTop3 = [...gamFunnels]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3)
      .map(f => ({ name: f.utmCampaign, revenue: f.revenue }));
    const utmSourceTop3 = [...gamSources]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3)
      .map(f => ({ name: f.utmSource, revenue: f.revenue }));

    // Build GAM UTM map for cross-referencing
    const gamUTMMap = Object.fromEntries(gamFunnels.map(g => [g.utmCampaign, g]));

    // Aggregate Meta across all BMs
    let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalResults = 0;
    const allCampaigns = [];
    const allAdsets = [];
    const allCreatives = [];
    const funnelAcc = {};
    const dailySpendMap = {};

    for (const bm of bms) {
      allCampaigns.push(...(bm.campaigns || []));
      allAdsets.push(...(bm.adsets || []));
      allCreatives.push(...(bm.topCreatives || []));

      for (const f of bm.funnels || []) {
        const k = f.objective;
        if (!funnelAcc[k]) funnelAcc[k] = { objective: k, spend: 0, results: 0, revenue: 0, impressions: 0, clicks: 0 };
        funnelAcc[k].spend += f.spend;
        funnelAcc[k].results += f.results;
        funnelAcc[k].revenue += f.revenue;
        funnelAcc[k].impressions += f.impressions;
        funnelAcc[k].clicks += f.clicks;
      }

      for (const day of bm.dailySpend || []) {
        dailySpendMap[day.date] = (dailySpendMap[day.date] || 0) + day.spend;
      }
    }

    const filteredCampaigns = domainFilter
      ? allCampaigns.filter(c => c.domain === domainFilter)
      : allCampaigns;
    const filteredAdsets = domainFilter
      ? allAdsets.filter(a => a.domain === domainFilter)
      : allAdsets;

    for (const c of filteredCampaigns) {
      totalSpend += c.spend || 0;
      totalImpressions += c.impressions || 0;
      totalClicks += c.clicks || 0;
      totalResults += c.results || 0;
    }

    // Add faturado and roi to each adset via UTM cross-reference
    const adsetsWithFaturado = filteredAdsets.map(a => {
      const gamData = a.utmCode ? (gamUTMMap[a.utmCode] || null) : null;
      const faturado = gamData?.revenue || 0;
      const roi = a.spend > 0 ? ((faturado - a.spend) / a.spend) * 100 : 0;
      return { ...a, faturado, roi };
    });

    const gamSummary = gamData?.summary || {};
    const faturamento = gamSummary.revenue || 0;
    const investimento = totalSpend;
    const lucro = faturamento - investimento;
    const roi = investimento > 0 ? (lucro / investimento) * 100 : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const cpm = totalImpressions > 0 ? (investimento / totalImpressions) * 1000 : 0;

    const kpis = {
      faturamento,
      investimento,
      lucro,
      roi,
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr,
      cpm,
      results: totalResults,
      costPerResult: totalResults > 0 ? investimento / totalResults : 0,
      ecpm: gamSummary.ecpm || 0,
      cpc: gamSummary.cpc || 0,
      viewability: gamSummary.viewability || 0,
      delayHours: gamData?.delayHours || 0,
      taxaProgramatica: gamSummary.taxaProgramatica || 0,
      rps: gamSummary.rps || 0,
      cpaIdeal: gamSummary.cpaIdeal || 0,
      serverImpressions: gamSummary.serverImpressions || 0,
      adxImpressions: gamSummary.adxImpressions || 0,
      usdToBrl: gamData?.usdToBrl || null,
    };

    const hasUTMCampaigns = filteredCampaigns.some(c => c.utmCode);
    let topFunnels;
    if (hasUTMCampaigns) {
      topFunnels = buildUTMFunnels(filteredCampaigns, gamUTMMap)
        .sort((a, b) => b.investimento - a.investimento)
        .slice(0, 4);
    } else {
      topFunnels = buildObjectiveFunnels(funnelAcc);
    }

    const topCampaigns = filteredCampaigns
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);

    const creativeMap = new Map();
    for (const c of allCreatives) {
      if (!creativeMap.has(c.id) || (c.results || 0) > (creativeMap.get(c.id).results || 0)) {
        creativeMap.set(c.id, c);
      }
    }
    const topCreatives = [...creativeMap.values()]
      .sort((a, b) => (b.results || 0) - (a.results || 0))
      .slice(0, 6);

    const adsets = adsetsWithFaturado.sort((a, b) => b.spend - a.spend);

    const trend = buildTrend(
      dailySpendMap,
      gamData?.dailyRevenue || {},
      dateRange.since,
      dateRange.until,
    );

    // Simplified gamUTMMap for frontend cross-referencing
    const gamUTMMapFrontend = Object.fromEntries(
      Object.entries(gamUTMMap).map(([k, v]) => [k, { revenue: v.revenue, ecpm: v.ecpm }])
    );

    const data = {
      kpis,
      topFunnels,
      topCampaigns,
      topCreatives,
      adsets,
      adUnits: gamData?.adUnits || [],
      topAdvertisers,
      utmCampaignTop3,
      utmSourceTop3,
      gamUTMMap: gamUTMMapFrontend,
      trend,
      networks,
    };

    cache.set(key, { data, timestamp: Date.now() });
    res.json(data);
  } catch (err) {
    console.error('[metrics]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
