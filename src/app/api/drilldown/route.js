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
      acc.spend       += Number(r.valor_gasto      || 0);
      acc.fat         += Number(r.faturamento_real  || 0);
      acc.lucro       += Number(r.lucro             || 0);
      acc.clicks      += Number(r.cliques           || 0);
      acc.results     += Number(r.resultado         || 0);
      acc.impressions += Number(r.impressoes_gam    || 0);
      return acc;
    }, { spend: 0, fat: 0, lucro: 0, clicks: 0, results: 0, impressions: 0 });

    total.roas = total.spend > 0 ? +(total.fat / total.spend).toFixed(4) : 0;
    total.cpc  = total.clicks > 0 ? +(total.spend / total.clicks).toFixed(4) : 0;

    // Fetch active Meta accounts
    const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
    const adsetsMap = new Map(); // adset_id → adset object

    console.log(`[drilldown ${utm}] contas: ${(accounts || []).length}`);

    for (const account of accounts || []) {
      try {
        // Search ADs whose name contains the UTM slug (e.g. "01-amafb", "amafb")
        const adRes = await axios.get(`${META_BASE}/${account.ad_account_id}/ads`, {
          params: {
            access_token: account.access_token,
            fields: 'id,name,status,effective_status,adset_id,adset{id,name,status,daily_budget,campaign{id,name}},creative{id,thumbnail_url,name}',
            filtering: JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: utm }]),
            limit: 200,
          },
          timeout: 20000,
        });

        const ads = adRes.data?.data || [];
        console.log(`[drilldown ${utm}] conta ${account.ad_account_id}: ${ads.length} ads encontrados`);

        for (const ad of ads) {
          if (!ad.adset) continue;
          const aid = ad.adset.id;
          if (!adsetsMap.has(aid)) {
            adsetsMap.set(aid, {
              adset_id: aid,
              adset_name: ad.adset.name,
              campaign_name: ad.adset.campaign?.name || '',
              status: ad.adset.status,
              daily_budget: ad.adset.daily_budget ? +(ad.adset.daily_budget / 100).toFixed(2) : null,
              account_id: account.ad_account_id,
              ads: [],
            });
          }
          adsetsMap.get(aid).ads.push({
            ad_id: ad.id,
            ad_name: ad.name,
            status: ad.status,
            effective_status: ad.effective_status,
            creative_id: ad.creative?.id,
            thumbnail_url: ad.creative?.thumbnail_url,
            creative_name: ad.creative?.name,
          });
        }
      } catch (e) {
        console.warn(`[drilldown] Meta API error for ${account.ad_account_id}:`, e.response?.data?.error?.message || e.message);
      }
    }

    console.log(`[drilldown ${utm}] adsets encontrados: ${adsetsMap.size}`);
    if (adsetsMap.size === 0) {
      console.log(`[drilldown ${utm}] PROBLEMA: nenhum ad com "${utm}" no nome encontrado em ${(accounts || []).length} contas`);
    }

    // Fetch insights for each adset (only from its own account)
    for (const account of accounts || []) {
      for (const [aid, adset] of adsetsMap) {
        if (adset.account_id !== account.ad_account_id) continue;
        try {
          const insRes = await axios.get(`${META_BASE}/${aid}/insights`, {
            params: {
              access_token: account.access_token,
              fields: 'spend,clicks,actions,cpc,ctr',
              date_preset: 'last_30d',
            },
            timeout: 10000,
          });
          const d = insRes.data?.data?.[0] || {};
          const results = (d.actions || []).find(a => a.action_type === 'lead' || a.action_type === 'purchase');
          adset.spend   = +d.spend || 0;
          adset.clicks  = +d.clicks || 0;
          adset.cpc     = +d.cpc || 0;
          adset.ctr     = +d.ctr || 0;
          adset.results = results ? +results.value : 0;
        } catch { /* skip insights if error */ }
      }
    }

    res.json({
      utm,
      total,
      adsets: Array.from(adsetsMap.values()),
      debug: {
        ads_no_banco: (rows || []).length,
        adsets_encontrados: adsetsMap.size,
        contas_pesquisadas: (accounts || []).length,
      },
    });
  } catch (err) {
    console.error('[drilldown]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
