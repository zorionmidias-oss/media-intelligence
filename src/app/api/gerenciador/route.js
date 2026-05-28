'use strict';
const axios    = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';
const _cache    = new Map();
const CACHE_MS  = 5 * 60 * 1000;

function cached(k)     { const e=_cache.get(k); return(!e||Date.now()-e.ts>CACHE_MS)?null:e.data; }
function setCache(k,d) { _cache.set(k,{ts:Date.now(),data:d}); }

function extractResults(actions) {
  if (!Array.isArray(actions)) return 0;
  const priority = [
    'offsite_conversion.fb_pixel_purchase','purchase',
    'offsite_conversion.fb_pixel_lead','lead','complete_registration',
    'offsite_conversion.fb_pixel_complete_registration','onsite_conversion.lead_grouped',
  ];
  for (const t of priority) {
    const found = actions.find(a => a.action_type === t);
    if (found) return +found.value;
  }
  const skip = new Set(['link_click','post_engagement','page_engagement','photo_view',
    'video_view','post','post_reaction','comment','video_play','landing_page_view',
    'onsite_conversion.post_save']);
  return actions.filter(a => !skip.has(a.action_type)).reduce((s,a) => s + +a.value, 0);
}

async function fetchItems(acc, level, parentId, datePreset) {
  const key = `meta:${acc.ad_account_id}:${level}:${parentId||''}:${datePreset}`;
  const hit  = cached(key);
  if (hit) return hit;

  const ins = `insights.date_preset(${datePreset}){spend,impressions,reach,clicks,cpc,cpm,ctr,actions,purchase_roas}`;

  let endpoint, fields;
  if (level === 'campaigns') {
    endpoint = `${acc.ad_account_id}/campaigns`;
    fields   = `id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,end_time,${ins}`;
  } else if (level === 'adsets') {
    endpoint = parentId ? `${parentId}/adsets` : `${acc.ad_account_id}/adsets`;
    fields   = `id,name,status,effective_status,campaign_id,campaign{id,name},daily_budget,lifetime_budget,start_time,end_time,${ins}`;
  } else {
    endpoint = parentId ? `${parentId}/ads` : `${acc.ad_account_id}/ads`;
    fields   = `id,name,status,effective_status,adset_id,adset{id,name,campaign_id,campaign{id,name}},creative{thumbnail_url},${ins}`;
  }

  const items = [];
  let nextUrl = `${META_BASE}/${endpoint}`;
  let params  = { access_token: acc.access_token, fields, limit: 200 };

  while (nextUrl) {
    const r = await axios.get(nextUrl, { params, timeout: 30000 });
    items.push(...(r.data.data || []));
    nextUrl = r.data.paging?.next || null;
    params  = {};
  }

  setCache(key, items);
  return items;
}

async function handler(req, res) {
  try {
    const { level='campaigns', account_id, campaign_id, adset_id, date_preset='last_30d' } = req.query;

    if (!['campaigns','adsets','ads'].includes(level))
      return res.status(400).json({ error: 'level inválido' });
    if (!['today','yesterday','last_7d','last_30d','last_90d','this_month','last_month'].includes(date_preset))
      return res.status(400).json({ error: 'date_preset inválido' });

    const parentId = level==='adsets' ? (campaign_id||null) : level==='ads' ? (adset_id||null) : null;

    let acctQ = supabase.from('meta_accounts').select('*').eq('ativo', true);
    if (account_id && account_id !== 'all') {
      const aid = account_id.startsWith('act_') ? account_id : `act_${account_id}`;
      acctQ = acctQ.eq('ad_account_id', aid);
    }
    const { data: accounts } = await acctQ;
    if (!accounts?.length) return res.json({ items: [], totals: {}, accounts: [] });

    const settled = await Promise.allSettled(
      accounts.map(acc => fetchItems(acc, level, parentId, date_preset))
    );

    const allItems = [];
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      if (settled[i].status !== 'fulfilled') {
        console.error(`[gerenciador] ${acc.ad_account_id}:`, settled[i].reason?.message);
        continue;
      }
      for (const item of settled[i].value) {
        const ins     = item.insights?.data?.[0] || {};
        const spend   = +(ins.spend || 0);
        const results = extractResults(ins.actions);

        const daily_budget    = item.daily_budget    && +item.daily_budget    > 0 ? +(item.daily_budget)    / 100 : null;
        const lifetime_budget = item.lifetime_budget && +item.lifetime_budget > 0 ? +(item.lifetime_budget) / 100 : null;

        const purchaseRoasArr = Array.isArray(ins.purchase_roas) ? ins.purchase_roas : [];
        const roas = +(purchaseRoasArr.find(r=>r.action_type==='omni_purchase')?.value || 0);

        allItems.push({
          id:            item.id,
          account_id:    acc.ad_account_id,
          account_name:  acc.nome,
          name:          item.name,
          status:        item.effective_status || item.status || 'UNKNOWN',
          objective:     item.objective || null,
          daily_budget,
          lifetime_budget,
          start_time:    item.start_time  || null,
          end_time:      item.end_time    || null,
          campaign_id:   item.campaign_id || item.adset?.campaign_id || null,
          campaign_name: item.campaign?.name || item.adset?.campaign?.name || null,
          adset_id:      item.adset_id || null,
          adset_name:    item.adset?.name || null,
          thumbnail_url: item.creative?.thumbnail_url || null,
          spend,
          impressions:   +(ins.impressions || 0),
          reach:         +(ins.reach       || 0),
          clicks:        +(ins.clicks      || 0),
          cpc:           +(ins.cpc         || 0),
          cpm:           +(ins.cpm         || 0),
          ctr:           +parseFloat(ins.ctr || 0).toFixed(4),
          roas,
          results,
          cost_per_result: results > 0 ? +(spend / results).toFixed(2) : 0,
        });
      }
    }

    allItems.sort((a, b) => b.spend - a.spend);

    const totals = allItems.reduce((t, r) => {
      t.spend       += r.spend;
      t.impressions += r.impressions;
      t.reach       += r.reach;
      t.clicks      += r.clicks;
      t.results     += r.results;
      return t;
    }, { spend:0, impressions:0, reach:0, clicks:0, results:0 });

    res.json({ items: allItems, totals, accounts: accounts.map(a=>({id:a.ad_account_id,name:a.nome})) });
  } catch (err) {
    console.error('[gerenciador]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
