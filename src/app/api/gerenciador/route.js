'use strict';
const axios    = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';
const _cache    = new Map(); // key→{ts,data}
const CACHE_MS  = 5 * 60 * 1000;

function cached(k)      { const e=_cache.get(k); return(!e||Date.now()-e.ts>CACHE_MS)?null:e.data; }
function setCache(k,d)  { _cache.set(k,{ts:Date.now(),data:d}); }

async function fetchMetaItems(acc, level) {
  const key = `meta:${acc.ad_account_id}:${level}`;
  const hit  = cached(key);
  if (hit) return hit;

  const fields = {
    campaigns: 'id,name,status,effective_status,objective,daily_budget,budget_remaining,start_time,end_time',
    adsets:    'id,name,status,effective_status,campaign_id,campaign{id,name},daily_budget,start_time,end_time',
    ads:       'id,name,status,effective_status,adset_id,adset{id,name,campaign_id,campaign{id,name}},creative{thumbnail_url}',
  }[level];

  const endpoint = {
    campaigns: `${acc.ad_account_id}/campaigns`,
    adsets:    `${acc.ad_account_id}/adsets`,
    ads:       `${acc.ad_account_id}/ads`,
  }[level];

  const items = [];
  let nextUrl = `${META_BASE}/${endpoint}`;
  let params  = { access_token: acc.access_token, fields, limit: 500 };

  while (nextUrl) {
    const r = await axios.get(nextUrl, { params, timeout: 25000 });
    items.push(...(r.data.data || []));
    nextUrl = r.data.paging?.next || null;
    params  = {}; // subsequent URLs already contain all params
  }

  setCache(key, items);
  return items;
}

async function handler(req, res) {
  try {
    const { level = 'campaigns', account_id, since, until } = req.query;
    const validLevels = ['campaigns', 'adsets', 'ads'];
    if (!validLevels.includes(level))
      return res.status(400).json({ error: 'level inválido' });

    const now      = new Date();
    const dateFrom = since || new Date(now - 30*86400000).toISOString().slice(0,10);
    const dateTo   = until || now.toISOString().slice(0,10);

    // Active accounts (optionally filtered)
    let acctQ = supabase.from('meta_accounts').select('*').eq('ativo', true);
    if (account_id && account_id !== 'all') {
      const aid = account_id.startsWith('act_') ? account_id : `act_${account_id}`;
      acctQ = acctQ.eq('ad_account_id', aid);
    }
    const { data: accounts } = await acctQ;
    if (!accounts?.length) return res.json({ items: [], totals: {}, accounts: [] });

    // DB grouping field per level
    const groupField = { campaigns: 'campanha_meta', adsets: 'conjunto_meta', ads: 'ad_utm' }[level];

    // Parallel: Meta API items (cached) + DB aggregate
    const [metaSettled, { data: dbRows }] = await Promise.all([
      Promise.allSettled(accounts.map(acc => fetchMetaItems(acc, level))),
      supabase
        .from('ads_consolidados')
        .select(`${groupField},campanha_meta,conjunto_meta,ad_utm,account_id,valor_gasto,faturamento_real,lucro,resultado,impressoes_gam,cliques,cpc,ecpm`)
        .gte('data', dateFrom)
        .lte('data', dateTo),
    ]);

    // Build Meta lookup: (lower_name|account_id) → item metadata
    const metaMap = new Map();
    for (let i = 0; i < accounts.length; i++) {
      const acc   = accounts[i];
      const items = metaSettled[i].status === 'fulfilled' ? metaSettled[i].value : [];
      for (const item of items) {
        const k = `${(item.name||'').toLowerCase()}|${acc.ad_account_id}`;
        metaMap.set(k, {
          id:            item.id,
          status:        item.effective_status || item.status || 'UNKNOWN',
          daily_budget:  item.daily_budget     ? +(item.daily_budget/100).toFixed(2)     : null,
          start_time:    item.start_time        || null,
          end_time:      item.end_time          || null,
          objective:     item.objective         || null,
          campaign_id:   item.campaign_id || item.adset?.campaign_id || null,
          campaign_name: item.campaign?.name || item.adset?.campaign?.name || null,
          adset_id:      item.adset_id          || null,
          adset_name:    item.adset?.name       || null,
          thumbnail_url: item.creative?.thumbnail_url || null,
        });
      }
    }

    // Aggregate DB rows by (groupField, account_id)
    const aggMap = new Map();
    for (const r of dbRows || []) {
      const name  = (r[groupField] || '').trim();
      const accId = r.account_id || '';
      if (!name) continue;
      const k = `${name.toLowerCase()}|${accId}`;
      if (!aggMap.has(k)) {
        aggMap.set(k, {
          name, account_id: accId,
          campanha_meta: r.campanha_meta || '',
          conjunto_meta: r.conjunto_meta || '',
          ad_utm:        r.ad_utm        || '',
          spend: 0, fat: 0, lucro: 0, results: 0, impressions: 0, clicks: 0,
          _cpcSum: 0, _cpcW: 0, _ecpmSum: 0, _ecpmW: 0,
        });
      }
      const g  = aggMap.get(k);
      g.spend      += +(r.valor_gasto    || 0);
      g.fat        += +(r.faturamento_real|| 0);
      g.lucro      += +(r.lucro          || 0);
      g.results    += +(r.resultado      || 0);
      g.impressions+= +(r.impressoes_gam || 0);
      g.clicks     += +(r.cliques        || 0);
      const cl = +(r.cliques||0), im = +(r.impressoes_gam||0);
      if (r.cpc  > 0 && cl > 0) { g._cpcSum  += r.cpc  * cl; g._cpcW  += cl; }
      if (r.ecpm > 0 && im > 0) { g._ecpmSum += r.ecpm * im; g._ecpmW += im; }
    }

    // Merge
    const acctMap = Object.fromEntries(accounts.map(a => [a.ad_account_id, a.nome]));
    const items = [];
    for (const [k, g] of aggMap) {
      const meta = metaMap.get(k) || {};
      items.push({
        id:            meta.id           || null,
        name:          g.name,
        account_id:    g.account_id,
        account_name:  acctMap[g.account_id] || g.account_id,
        status:        meta.status       || 'UNKNOWN',
        campanha_meta: g.campanha_meta,
        conjunto_meta: g.conjunto_meta,
        ad_utm:        g.ad_utm,
        campaign_id:   meta.campaign_id  || null,
        campaign_name: meta.campaign_name|| null,
        adset_id:      meta.adset_id     || null,
        adset_name:    meta.adset_name   || null,
        objective:     meta.objective    || null,
        daily_budget:  meta.daily_budget,
        start_time:    meta.start_time,
        end_time:      meta.end_time,
        thumbnail_url: meta.thumbnail_url|| null,
        spend:         +g.spend.toFixed(2),
        faturamento:   +g.fat.toFixed(2),
        lucro:         +g.lucro.toFixed(2),
        roas:          g.spend > 0 ? +(g.fat/g.spend).toFixed(4) : 0,
        results:       g.results,
        cost_per_result: g.results > 0 ? +(g.spend/g.results).toFixed(2) : 0,
        impressions:   g.impressions,
        clicks:        g.clicks,
        cpc:           g._cpcW  > 0 ? +(g._cpcSum /g._cpcW ).toFixed(4) : 0,
        ecpm:          g._ecpmW > 0 ? +(g._ecpmSum/g._ecpmW).toFixed(2) : 0,
      });
    }

    items.sort((a, b) => b.spend - a.spend);

    const totals = items.reduce((acc, r) => {
      acc.spend       += r.spend;
      acc.faturamento += r.faturamento;
      acc.lucro       += r.lucro;
      acc.results     += r.results;
      acc.impressions += r.impressions;
      return acc;
    }, { spend:0, faturamento:0, lucro:0, results:0, impressions:0 });

    res.json({
      items,
      totals,
      accounts: accounts.map(a => ({ id: a.ad_account_id, name: a.nome })),
    });
  } catch (err) {
    console.error('[gerenciador]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
