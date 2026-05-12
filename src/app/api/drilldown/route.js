'use strict';
const axios = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';

async function handler(req, res) {
  try {
    const utm = req.params.utm;
    if (!utm) return res.status(400).json({ error: 'UTM é obrigatório' });

    const since = req.query.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const until = req.query.until || new Date().toISOString().slice(0, 10);

    // Aggregate local DB metrics for this UTM
    const { data: rows } = await supabase
      .from('ads_consolidados')
      .select('data,valor_gasto,faturamento_real,lucro,cliques,resultado,impressoes_gam,ecpm,rps,cpc,roas,orcamento_total')
      .eq('ad_utm', utm)
      .gte('data', since)
      .lte('data', until);

    const total = (rows || []).reduce((acc, r) => {
      acc.spend    += Number(r.valor_gasto     || 0);
      acc.fat      += Number(r.faturamento_real || 0);
      acc.lucro    += Number(r.lucro            || 0);
      acc.clicks   += Number(r.cliques          || 0);
      acc.results  += Number(r.resultado        || 0);
      acc.impressions += Number(r.impressoes_gam || 0);
      return acc;
    }, { spend: 0, fat: 0, lucro: 0, clicks: 0, results: 0, impressions: 0 });

    total.roas = total.spend > 0 ? +(total.fat / total.spend).toFixed(4) : 0;
    total.cpc  = total.clicks > 0 ? +(total.spend / total.clicks).toFixed(4) : 0;

    // Try Meta API to get adsets
    const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
    const adsets = [];

    for (const account of accounts || []) {
      try {
        const adsetRes = await axios.get(`${META_BASE}/${account.ad_account_id}/adsets`, {
          params: {
            access_token: account.access_token,
            fields: 'id,name,status,daily_budget,campaign_id,campaign{name}',
            filtering: JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: utm }]),
            limit: 50,
          },
          timeout: 15000,
        });

        for (const adset of adsetRes.data?.data || []) {
          // Get ads for this adset
          let ads = [];
          try {
            const adRes = await axios.get(`${META_BASE}/${adset.id}/ads`, {
              params: {
                access_token: account.access_token,
                fields: 'id,name,status,creative{id,thumbnail_url,object_story_spec,video_id}',
                limit: 20,
              },
              timeout: 15000,
            });
            ads = adRes.data?.data || [];
          } catch { /* skip creatives if error */ }

          // Get insights
          let insights = {};
          try {
            const insRes = await axios.get(`${META_BASE}/${adset.id}/insights`, {
              params: {
                access_token: account.access_token,
                fields: 'spend,clicks,actions,cpc,ctr',
                date_preset: 'last_30d',
              },
              timeout: 10000,
            });
            const d = insRes.data?.data?.[0] || {};
            const results = (d.actions || []).find(a => a.action_type === 'lead' || a.action_type === 'purchase');
            insights = {
              spend: +d.spend || 0,
              clicks: +d.clicks || 0,
              cpc: +d.cpc || 0,
              ctr: +d.ctr || 0,
              results: results ? +results.value : 0,
            };
          } catch { /* skip insights if error */ }

          adsets.push({
            adset_id: adset.id,
            adset_name: adset.name,
            campaign_name: adset.campaign?.name || '',
            status: adset.status,
            daily_budget: adset.daily_budget ? +(adset.daily_budget / 100).toFixed(2) : null,
            account_id: account.ad_account_id,
            ...insights,
            ads,
          });
        }
      } catch (e) {
        console.warn(`[drilldown] Meta API error for ${account.ad_account_id}:`, e.response?.data?.error?.message || e.message);
      }
    }

    res.json({ utm, total, adsets });
  } catch (err) {
    console.error('[drilldown]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
