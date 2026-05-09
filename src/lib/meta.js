'use strict';
const axios = require('axios');

const BASE = 'https://graph.facebook.com/v19.0';
const INSIGHT_FIELDS = 'spend,impressions,clicks,ctr,cpm,cpc,purchase_roas,actions,action_values';

// Extracts [DOMAIN] [UTM_CODE] [PAGE] from campaign/adset names
const UTM_RE3 = /\[([^\]]+)\]\s*\[([^\]]+)\]\s*\[([^\]]+)\]/;
const UTM_RE = /\[([^\]]+)\]\s*\[([^\]]+)\]/;
function extractDomainUTM(name) {
  if (!name) return { domain: null, utmCode: null, page: null };
  const m3 = name.match(UTM_RE3);
  if (m3) return { domain: m3[1].trim(), utmCode: m3[2].trim(), page: m3[3].trim() };
  const m = name.match(UTM_RE);
  if (m) return { domain: m[1].trim(), utmCode: m[2].trim(), page: null };
  return { domain: null, utmCode: null, page: null };
}

// Extracts page from adset name: "[ZURI] V0" → "ZURI"
function extractPage(name) {
  if (!name) return null;
  const m = String(name).match(/^\[([^\]]+)\]/);
  return m ? m[1].trim() : null;
}

function getBMConfigs() {
  const configs = [];
  for (let i = 1; i <= 5; i++) {
    const token = process.env[`META_ACCESS_TOKEN_BM${i}`];
    const account = process.env[`META_AD_ACCOUNT_BM${i}`];
    if (token && account) {
      configs.push({ id: i, token, account });
    }
  }
  return configs;
}

function findAction(arr, types) {
  if (!arr) return 0;
  for (const t of (Array.isArray(types) ? types : [types])) {
    const found = arr.find(a => a.action_type === t);
    if (found) return Number(found.value || 0);
  }
  return 0;
}

function getResults(actions) {
  return (
    findAction(actions, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']) ||
    findAction(actions, ['lead', 'onsite_web_lead', 'offsite_conversion.fb_pixel_lead']) ||
    findAction(actions, ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration']) ||
    findAction(actions, 'link_click')
  );
}

function getRevenue(actionValues) {
  return (
    findAction(actionValues, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']) ||
    0
  );
}

async function apiGet(url, params) {
  const res = await axios.get(url, { params, timeout: 30000 });
  return res.data;
}

async function fetchInsights(accountId, token, extra = {}) {
  const data = await apiGet(`${BASE}/${accountId}/insights`, {
    access_token: token,
    fields: INSIGHT_FIELDS,
    limit: 200,
    ...extra,
  });
  return data.data || [];
}

async function fetchBMMetrics(config, dateRange) {
  const { token, account } = config;
  const accountId = account.startsWith('act_') ? account : `act_${account}`;

  const timeParams = dateRange
    ? { time_range: JSON.stringify({ since: dateRange.since, until: dateRange.until }) }
    : { date_preset: 'last_30d' };

  const [accRows, campRows, adsetRows, adRows, dailyRows, campaignObjs, adsetStatuses] = await Promise.all([
    fetchInsights(accountId, token, { ...timeParams, level: 'account' }),
    fetchInsights(accountId, token, {
      ...timeParams,
      level: 'campaign',
      fields: `campaign_id,campaign_name,${INSIGHT_FIELDS}`,
      limit: 100,
    }),
    fetchInsights(accountId, token, {
      ...timeParams,
      level: 'adset',
      fields: `adset_id,adset_name,campaign_id,campaign_name,${INSIGHT_FIELDS}`,
      limit: 200,
    }),
    fetchInsights(accountId, token, {
      ...timeParams,
      level: 'ad',
      fields: `ad_id,ad_name,campaign_id,campaign_name,${INSIGHT_FIELDS}`,
      limit: 50,
    }),
    fetchInsights(accountId, token, { ...timeParams, level: 'account', time_increment: 1, limit: 93 }),
    apiGet(`${BASE}/${accountId}/campaigns`, {
      access_token: token,
      fields: 'id,objective,effective_status',
      limit: 200,
    }).then(d => d.data || []).catch(() => []),
    apiGet(`${BASE}/${accountId}/adsets`, {
      access_token: token,
      fields: 'id,effective_status',
      limit: 500,
    }).then(d => d.data || []).catch(() => []),
  ]);

  // Account summary
  const acc = accRows[0] || {};
  const spend = Number(acc.spend || 0);
  const impressions = Number(acc.impressions || 0);
  const clicks = Number(acc.clicks || 0);
  const ctr = Number(acc.ctr || 0);
  const cpm = Number(acc.cpm || 0);
  const cpc = Number(acc.cpc || 0);
  const results = getResults(acc.actions);
  const revenue = getRevenue(acc.action_values);
  const profit = revenue - spend;
  const costPerResult = results > 0 ? spend / results : 0;
  const rps = results > 0 ? spend / results : 0;
  const cpaIdeal = rps / 1000;
  const ecpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
  const purchaseRoas = Array.isArray(acc.purchase_roas)
    ? Number(acc.purchase_roas[0]?.value || 0)
    : 0;

  const adsetStatusMap = Object.fromEntries((adsetStatuses || []).map(s => [s.id, s.effective_status || '—']));
  const campaignStatusMap = Object.fromEntries((campaignObjs || []).map(c => [c.id, c.effective_status || '—']));

  // Campaigns
  const campaigns = campRows.map(c => {
    const s = Number(c.spend || 0);
    const res = getResults(c.actions);
    const rev = getRevenue(c.action_values);
    const { domain, utmCode, page } = extractDomainUTM(c.campaign_name);
    return {
      id: c.campaign_id,
      name: c.campaign_name,
      domain,
      utmCode,
      page,
      status: campaignStatusMap[c.campaign_id] || '—',
      spend: s,
      impressions: Number(c.impressions || 0),
      clicks: Number(c.clicks || 0),
      ctr: Number(c.ctr || 0),
      cpm: Number(c.cpm || 0),
      cpc: Number(c.cpc || 0),
      results: res,
      revenue: rev,
      profit: rev - s,
      costPerResult: res > 0 ? s / res : 0,
      roas: s > 0 ? rev / s : 0,
      source: 'meta',
    };
  });

  // Adsets — extract domain/utmCode from campaign name, page from adset name
  const adsets = adsetRows.map(a => {
    const s = Number(a.spend || 0);
    const res = getResults(a.actions);
    const { domain, utmCode, page: campaignPage } = extractDomainUTM(a.campaign_name);
    const page = extractPage(a.adset_name) || campaignPage;
    return {
      id: a.adset_id,
      name: a.adset_name,
      campaignId: a.campaign_id,
      campaignName: a.campaign_name,
      domain,
      utmCode,
      page,
      status: adsetStatusMap[a.adset_id] || '—',
      spend: s,
      impressions: Number(a.impressions || 0),
      clicks: Number(a.clicks || 0),
      ctr: Number(a.ctr || 0),
      cpm: Number(a.cpm || 0),
      cpc: Number(a.cpc || 0),
      results: res,
      costPerResult: res > 0 ? s / res : 0,
      source: 'meta',
    };
  });

  // Top creatives (top 6 ads by results)
  const sortedAds = [...adRows].sort((a, b) => getResults(b.actions) - getResults(a.actions));
  const topAds = sortedAds.slice(0, 6);
  let topCreatives = [];

  if (topAds.length) {
    try {
      const ids = topAds.map(a => a.ad_id).join(',');
      const creativeData = await apiGet(`${BASE}/`, {
        access_token: token,
        ids,
        fields: 'id,name,creative{thumbnail_url,title,body}',
      });
      topCreatives = topAds.map(ad => {
        const info = creativeData[ad.ad_id] || {};
        const s = Number(ad.spend || 0);
        const res = getResults(ad.actions);
        return {
          id: ad.ad_id,
          name: ad.ad_name,
          campaignName: ad.campaign_name,
          spend: s,
          impressions: Number(ad.impressions || 0),
          clicks: Number(ad.clicks || 0),
          results: res,
          costPerResult: res > 0 ? s / res : 0,
          thumbnail: info.creative?.thumbnail_url || null,
          title: info.creative?.title || ad.ad_name,
          body: info.creative?.body || null,
        };
      });
    } catch {
      topCreatives = topAds.map(ad => {
        const s = Number(ad.spend || 0);
        const res = getResults(ad.actions);
        return {
          id: ad.ad_id,
          name: ad.ad_name,
          campaignName: ad.campaign_name,
          spend: s,
          impressions: Number(ad.impressions || 0),
          clicks: Number(ad.clicks || 0),
          results: res,
          costPerResult: res > 0 ? s / res : 0,
          thumbnail: null,
          title: ad.ad_name,
        };
      });
    }
  }

  // Funnels by campaign objective (top 4)
  const objMap = Object.fromEntries(campaignObjs.map(c => [c.id, c.objective]));
  const funnelAcc = {};
  for (const c of campaigns) {
    const obj = objMap[c.id] || 'UNKNOWN';
    if (!funnelAcc[obj]) {
      funnelAcc[obj] = { objective: obj, spend: 0, results: 0, revenue: 0, impressions: 0, clicks: 0 };
    }
    funnelAcc[obj].spend += c.spend;
    funnelAcc[obj].results += c.results;
    funnelAcc[obj].revenue += c.revenue;
    funnelAcc[obj].impressions += c.impressions;
    funnelAcc[obj].clicks += c.clicks;
  }
  const funnels = Object.values(funnelAcc)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 4)
    .map(f => ({
      ...f,
      ctr: f.impressions > 0 ? (f.clicks / f.impressions) * 100 : 0,
      costPerResult: f.results > 0 ? f.spend / f.results : 0,
      roas: f.spend > 0 ? f.revenue / f.spend : 0,
    }));

  // Daily spend data for trend
  const dailySpend = dailyRows.map(d => ({
    date: d.date_start,
    spend: Number(d.spend || 0),
    impressions: Number(d.impressions || 0),
    clicks: Number(d.clicks || 0),
  }));

  return {
    accountId,
    summary: { spend, impressions, clicks, ctr, cpm, cpc, results, revenue, profit, costPerResult, rps, cpaIdeal, ecpm, purchaseRoas },
    campaigns: campaigns.sort((a, b) => b.spend - a.spend),
    adsets: adsets.sort((a, b) => b.spend - a.spend),
    topCreatives,
    funnels,
    dailySpend,
  };
}

async function fetchAllBMs(dateRange) {
  const configs = getBMConfigs();
  if (!configs.length) return [];
  const settled = await Promise.allSettled(configs.map(c => fetchBMMetrics(c, dateRange)));
  return settled
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

module.exports = { fetchAllBMs, fetchBMMetrics, getBMConfigs };
