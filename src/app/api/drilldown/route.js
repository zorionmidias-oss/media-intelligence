'use strict';
const axios = require('axios');
const supabase = require('../../../lib/supabase');
const { getUSDtoBRLByDate } = require('../../../lib/gam');
const { extractAdUTM, extractTipo } = require('../../../lib/parser');
const { getResultadoMeta, findAction } = require('../../../services/attribution.service');

const META_BASE = 'https://graph.facebook.com/v19.0';

// 60-second memory cache per utm:since:until
const _cache = new Map();
function getCached(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > 60000) { _cache.delete(k); return null; }
  return e.data;
}
function setCache(k, d) { _cache.set(k, { ts: Date.now(), data: d }); }

function resultActionType(objective) {
  const m = {
    OUTCOME_LEADS: 'lead', OUTCOME_SALES: 'purchase',
    OUTCOME_TRAFFIC: 'link_click', OUTCOME_ENGAGEMENT: 'post_engagement',
    OUTCOME_APP_PROMOTION: 'app_install', OUTCOME_AWARENESS: 'reach',
    LEAD_GENERATION: 'lead', CONVERSIONS: 'purchase',
    LINK_CLICKS: 'link_click', MESSAGES: 'onsite_conversion.messaging_conversation_started_7d',
  };
  return m[objective] || 'link_click';
}

function pickResult(actions, objective) {
  if (!actions?.length) return null;
  const pref = resultActionType(objective);
  return actions.find(a => a.action_type === pref)
      || actions.find(a => ['lead', 'purchase', 'link_click', 'landing_page_view'].includes(a.action_type))
      || null;
}

async function handler(req, res) {
  try {
    const utm = req.params.utm;
    if (!utm) return res.status(400).json({ error: 'UTM é obrigatório' });

    const since = req.query.since || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const until = req.query.until || new Date().toISOString().slice(0, 10);
    const noCache = req.query.nocache === '1';
    // adsets_only: pula insights por anúncio (expand inline não mostra criativos) → bem mais rápido
    const adsetsOnly = req.query.adsets_only === '1';

    const cacheKey = `${utm}:${since}:${until}:${adsetsOnly ? 'a' : 'f'}`;
    if (!noCache) {
      const hit = getCached(cacheKey);
      if (hit) {
        console.log(`[drilldown ${utm}] cache hit`);
        return res.json({ ...hit, _cached: true });
      }
    }

    // ── DB aggregate ────────────────────────────────────────────────────────
    const { data: rows } = await supabase
      .from('ads_consolidados')
      .select('data,valor_gasto,faturamento_real,lucro,cliques,resultado,impressoes_gam,ecpm,rps,cpc,roas')
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

    const rpsArr = (rows || []).map(r => Number(r.rps || 0)).filter(v => v > 0);
    total.rps = rpsArr.length ? rpsArr.reduce((s, v) => s + v, 0) / rpsArr.length : 0;

    // ── Accounts ─────────────────────────────────────────────────────────────
    const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
    console.log(`[drilldown ${utm}] contas: ${(accounts || []).length}`);

    // ── Parallel: fetch ads from all accounts ────────────────────────────────
    const adsetsMap = new Map(); // adset_id → adset object

    await Promise.allSettled((accounts || []).map(acc =>
      axios.get(`${META_BASE}/${acc.ad_account_id}/ads`, {
        params: {
          access_token: acc.access_token,
          fields: 'id,name,status,effective_status,adset_id,adset{id,name,status,daily_budget,campaign{id,name,objective}},creative{id,thumbnail_url,name}',
          filtering: JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: utm }]),
          limit: 200,
        },
        timeout: 20000,
      }).then(r => {
        const ads = r.data?.data || [];
        console.log(`[drilldown ${utm}] conta ${acc.ad_account_id}: ${ads.length} ads`);
        for (const ad of ads) {
          if (!ad.adset) continue;
          // Bug C: CONTAIN filter from Meta API can match substrings (e.g. "ama" in "ADAMA")
          // Re-validate with the same extractAdUTM normalization used by sync
          if (extractAdUTM(ad.name) !== utm.toLowerCase()) continue;
          const aid = ad.adset.id;
          if (!adsetsMap.has(aid)) {
            adsetsMap.set(aid, {
              adset_id: aid,
              adset_name: ad.adset.name,
              campaign_id: ad.adset.campaign?.id || '',
              campaign_name: ad.adset.campaign?.name || '',
              campaign_objective: ad.adset.campaign?.objective || '',
              status: ad.adset.status,
              daily_budget: ad.adset.daily_budget ? +(ad.adset.daily_budget / 100).toFixed(2) : null,
              account_id: acc.ad_account_id,
              _token: acc.access_token,
              ads: [],
              spend: 0, clicks: 0, cpc: 0, ctr: 0, cpm: 0,
              impressions: 0, results: 0, cost_per_result: 0,
              resultado_vc: 0, conversas: 0,
            });
          }
          adsetsMap.get(aid).ads.push({
            ad_id: ad.id,
            ad_name: ad.name,
            status: ad.status,
            effective_status: ad.effective_status,
            thumbnail_url: ad.creative?.thumbnail_url || null,
            creative_name: ad.creative?.name || null,
            spend: 0, clicks: 0, ctr: 0, results: 0, cost_per_result: 0,
          });
        }
      }).catch(e => {
        console.warn(`[drilldown] ${acc.ad_account_id}:`, e.response?.data?.error?.message || e.message);
      })
    ));

    console.log(`[drilldown ${utm}] adsets encontrados: ${adsetsMap.size}`);
    if (adsetsMap.size === 0) {
      console.log(`[drilldown ${utm}] PROBLEMA: nenhum ad com "${utm}" no nome em ${(accounts || []).length} contas`);
    }

    // ── Parallel: fetch all insights (adset + ad level) ──────────────────────
    const insightJobs = [];

    for (const [aid, adset] of adsetsMap) {
      const token = adset._token;
      const obj = adset.campaign_objective;

      insightJobs.push(
        axios.get(`${META_BASE}/${aid}/insights`, {
          params: {
            access_token: token,
            fields: 'spend,clicks,impressions,ctr,cpc,cpm,actions,cost_per_action_type',
            time_range: JSON.stringify({ since, until }),
          },
          timeout: 12000,
        }).then(r => {
          const d = r.data?.data?.[0];
          if (!d) return;
          const ra = pickResult(d.actions, obj);
          const cpa = d.cost_per_action_type?.find(c => c.action_type === resultActionType(obj));
          adset.spend       = +d.spend || 0;
          adset.clicks      = +d.clicks || 0;
          adset.cpc         = +d.cpc || 0;
          adset.ctr         = +d.ctr || 0;
          adset.cpm         = +d.cpm || 0;
          adset.impressions = +d.impressions || 0;
          adset.results     = ra ? +ra.value : 0;
          adset.cost_per_result = cpa ? +cpa.value : (adset.results > 0 ? adset.spend / adset.results : 0);
          // Otimização rápida: resultado = view_content (funil bot) / objetivo (direto),
          // conversas = mensagens iniciadas. Mesma lógica do sync (ads_consolidados).
          const tipo = extractTipo(adset.campaign_name);
          adset.resultado_vc = getResultadoMeta({ actions: d.actions, objective: obj }, tipo);
          adset.conversas    = findAction(d.actions, ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply']);
        }).catch(() => {})
      );

      if (adsetsOnly) continue; // expand inline não precisa de dados por anúncio

      for (const ad of adset.ads) {
        insightJobs.push(
          axios.get(`${META_BASE}/${ad.ad_id}/insights`, {
            params: {
              access_token: token,
              fields: 'spend,clicks,impressions,ctr,cpc,actions,cost_per_action_type',
              time_range: JSON.stringify({ since, until }),
            },
            timeout: 10000,
          }).then(r => {
            const d = r.data?.data?.[0];
            if (!d) return;
            const ra = pickResult(d.actions, obj);
            const cpa = d.cost_per_action_type?.find(c => c.action_type === resultActionType(obj));
            ad.spend          = +d.spend || 0;
            ad.clicks         = +d.clicks || 0;
            ad.ctr            = +d.ctr || 0;
            ad.results        = ra ? +ra.value : 0;
            ad.cost_per_result = cpa ? +cpa.value : (ad.results > 0 ? ad.spend / ad.results : 0);
          }).catch(() => {})
        );
      }
    }

    await Promise.allSettled(insightJobs);

    // Bug A: convert USD→BRL for accounts with moeda='USD'
    // acc.moeda existe após a migration; acc.currency é a coluna legada — checar ambas
    const accountCfgMap = {};
    for (const acc of accounts || []) {
      accountCfgMap[acc.ad_account_id] = {
        moeda: acc.moeda || acc.currency || 'BRL',
        imposto: Number(acc.imposto_percentual || 0),
      };
    }
    let _usdRate = null;
    for (const adset of adsetsMap.values()) {
      const cfg = accountCfgMap[adset.account_id] || { moeda: 'BRL', imposto: 0 };
      if (cfg.moeda !== 'USD') continue;
      if (!_usdRate) _usdRate = await getUSDtoBRLByDate(until);
      const fator = _usdRate * (1 + cfg.imposto / 100);
      console.log(`[drilldown ${utm}] adset "${adset.adset_name}" conta=${adset.account_id} USD taxa=${_usdRate} fator=${fator.toFixed(4)}`);
      adset.spend    = +(adset.spend * fator).toFixed(2);
      adset.cpc      = adset.clicks > 0 ? +(adset.spend / adset.clicks).toFixed(4) : 0;
      adset.cpm      = adset.impressions > 0 ? +(adset.spend / adset.impressions * 1000).toFixed(4) : 0;
      adset.cost_per_result = adset.results > 0 ? +(adset.spend / adset.results).toFixed(2) : 0;
      for (const ad of adset.ads || []) {
        ad.spend = +(ad.spend * fator).toFixed(2);
        ad.cpc   = ad.clicks > 0 ? +(ad.spend / ad.clicks).toFixed(4) : 0;
        ad.cost_per_result = ad.results > 0 ? +(ad.spend / ad.results).toFixed(2) : 0;
      }
    }

    // Piso de orçamento = 1 USD na moeda da conta (bloqueia -20% abaixo do mínimo Meta).
    // USD → 1.00; BRL → 1 USD convertido pela taxa do dia.
    for (const adset of adsetsMap.values()) {
      const cfg = accountCfgMap[adset.account_id] || { moeda: 'BRL' };
      adset.moeda = cfg.moeda === 'USD' ? 'USD' : 'BRL';
      // Piso = 1 USD: contas USD → 1.00 (própria moeda); contas BRL → 1 USD na taxa do dia
      if (adset.moeda === 'USD') {
        adset.min_budget = 1;
      } else {
        if (!_usdRate) _usdRate = await getUSDtoBRLByDate(until);
        adset.min_budget = _usdRate ? +(+_usdRate).toFixed(2) : 1;
      }
    }

    // Strip auth token before sending
    for (const a of adsetsMap.values()) delete a._token;

    const payload = {
      utm,
      total,
      adsets: Array.from(adsetsMap.values()).filter(a => a.spend > 0).sort((a, b) => b.spend - a.spend),
      debug: {
        ads_no_banco: (rows || []).length,
        adsets_encontrados: adsetsMap.size,
        contas_pesquisadas: (accounts || []).length,
      },
    };
    setCache(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('[drilldown]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
