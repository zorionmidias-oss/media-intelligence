'use strict';
const axios = require('axios');
const supabase = require('./supabase');
const { getBMConfigs, updateBMStatus } = require('./meta');
const { fetchGAMReport, fetchGAMFunnelsByUTM, getUSDtoBRL } = require('./gam');
const { extractDomainPrefix, extractAdUTM, extractTipo, groupAdsByUTM } = require('./parser');

const BASE = 'https://graph.facebook.com/v19.0';
const AD_FIELDS = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions,objective,optimization_goal';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function findAction(arr, types) {
  if (!Array.isArray(arr)) return 0;
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

const OBJECTIVE_ACTION_MAP = {
  'OUTCOME_LEADS':      ['lead', 'onsite_conversion.lead_grouped'],
  'LEAD_GENERATION':    ['lead'],
  'OUTCOME_SALES':      ['purchase', 'omni_purchase'],
  'CONVERSIONS':        ['offsite_conversion.fb_pixel_purchase', 'purchase'],
  'OUTCOME_TRAFFIC':    ['link_click'],
  'LINK_CLICKS':        ['link_click'],
  'PAGE_VIEW':          ['landing_page_view'],
  'OUTCOME_AWARENESS':  ['impressions'],
  'OUTCOME_ENGAGEMENT': ['post_engagement'],
};

function getResultadoMeta(ad) {
  const actions = ad.actions || [];
  const objetivo = ad.objective || ad.optimization_goal;
  // If objective is mapped, try those specific action types first
  const expected = OBJECTIVE_ACTION_MAP[objetivo] || ['link_click'];
  for (const type of expected) {
    const found = actions.find(a => a.action_type === type);
    if (found) return Number(found.value);
  }
  // Fallback: total clicks from Meta insights (cost-per-click metric)
  return Number(ad.clicks || 0);
}

// Fetch all ads with insights for every configured BM account
async function fetchMetaAdsForSync(dateRange) {
  const configs = await getBMConfigs();
  const since = dateRange?.since || today();
  const until = dateRange?.until || today();
  const timeParams = { time_range: JSON.stringify({ since, until }) };

  const allAds = [];
  const budgetByAccount = {}; // accountId → Map(campaignId → budget)

  for (const config of configs) {
    try {
      const { token, account } = config;
      const accountId = account.startsWith('act_') ? account : `act_${account}`;

      // Fetch campaign budgets (CBO: budget set at campaign level)
      const campBudgetRes = await axios.get(`${BASE}/${accountId}/campaigns`, {
        params: { access_token: token, fields: 'id,daily_budget,lifetime_budget,start_time,stop_time', limit: 500 },
        timeout: 30000,
      }).catch(() => ({ data: { data: [] } }));
      const campBudgetMap = new Map();
      for (const c of campBudgetRes.data?.data || []) {
        const rawDaily = Number(c.daily_budget || 0);
        const rawLt = Number(c.lifetime_budget || 0);
        if (rawDaily > 0) {
          campBudgetMap.set(c.id, rawDaily / 100);
        } else if (rawLt > 0) {
          const start = c.start_time ? new Date(c.start_time) : new Date();
          const end = c.stop_time ? new Date(c.stop_time) : new Date();
          const days = Math.max(1, Math.round((end - start) / 86400000));
          campBudgetMap.set(c.id, (rawLt / 100) / days);
        }
      }

      // Fetch adset budgets (ABO: budget set at adset level); fall back to CBO campaign budget
      const adsetBudgetRes = await axios.get(`${BASE}/${accountId}/adsets`, {
        params: { access_token: token, fields: 'id,campaign_id,daily_budget,lifetime_budget', limit: 500 },
        timeout: 30000,
      }).catch(e => {
        console.warn(`[sync Meta BM${config.id}] adsets fetch failed (${e.response?.status ?? e.code}): ${e.message} — budgets will be 0`);
        return { data: { data: [] } };
      });
      const budgetMap = new Map();
      for (const a of adsetBudgetRes.data?.data || []) {
        const rawDaily = Number(a.daily_budget || 0);
        const rawLt = Number(a.lifetime_budget || 0);
        let budget = 0;
        if (rawDaily > 0) {
          budget = rawDaily / 100;
        } else if (rawLt > 0) {
          budget = (rawLt / 100) / 30; // lifetime ÷ 30d estimate
        } else {
          budget = campBudgetMap.get(a.campaign_id) || 0; // CBO fallback
        }
        if (budget > 0) budgetMap.set(a.id, budget);
      }
      budgetByAccount[accountId] = budgetMap;

      // Paginated fetch of all ads — time_increment:1 gives one row per ad per day
      let reqUrl = `${BASE}/${accountId}/insights`;
      let params = {
        access_token: token,
        level: 'ad',
        fields: AD_FIELDS,
        time_increment: 1,
        limit: 500,
        ...timeParams,
      };
      let hasMore = true;

      while (hasMore) {
        const res = await axios.get(reqUrl, { params, timeout: 60000 });
        const rows = res.data?.data || [];
        for (const r of rows) {
          r._bmId = config.id;
          r._accountId = accountId;
          r._adsetBudget = budgetMap.get(r.adset_id) || 0;
        }
        allAds.push(...rows);

        const nextUrl = res.data?.paging?.next;
        if (nextUrl && rows.length > 0) {
          reqUrl = nextUrl;
          params = {}; // next URL already has all params
          hasMore = true;
        } else {
          hasMore = false;
        }
      }
      await updateBMStatus(config.id, 'OK');
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.error(`[sync Meta BM${config.id}] status=${e.response?.status ?? 'N/A'} ${detail}`);
      await updateBMStatus(config.id, `ERR_${e.response?.status ?? 'N/A'}`, detail);
    }
  }

  return allAds;
}

// ─────────────────────────────────────────────
// Main sync function
// ─────────────────────────────────────────────
function yesterday() {
  return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
}

async function syncAll(dateRange) {
  const startMs = Date.now();
  let rowsProcessed = 0;

  try {
    // Default: yesterday + today so yesterday's finalized spend gets captured
    const until = dateRange?.until || today();
    const since = dateRange?.since || yesterday();
    const dr = { since, until };

    // Load active domains from Supabase
    const { data: dominios, error: domErr } = await supabase
      .from('dominios')
      .select('id,nome,prefixo_campanha,codigo_pedido_gam')
      .eq('ativo', true);

    // Load Meta accounts imposto map: ad_account_id → imposto_percentual
    const { data: metaAccountsData } = await supabase
      .from('meta_accounts')
      .select('ad_account_id,imposto_percentual');
    const impostoMap = {};
    for (const acc of metaAccountsData || []) {
      impostoMap[acc.ad_account_id] = Number(acc.imposto_percentual || 0);
    }

    if (domErr) throw new Error(`dominios query: ${domErr.message}`);

    const domainByPrefix = {};
    for (const d of dominios || []) {
      domainByPrefix[d.prefixo_campanha.toUpperCase()] = d;
    }

    // Fetch Meta ads, GAM report, GAM UTM funnels — all in parallel
    const [metaAds, gamReport, gamFunnels] = await Promise.all([
      fetchMetaAdsForSync(dr).catch(e => { console.error('[sync] Meta:', e.message); return []; }),
      fetchGAMReport(dr).catch(e => { console.error('[sync] GAM report:', e.message); return null; }),
      fetchGAMFunnelsByUTM(null, dr).catch(e => { console.error('[sync] GAM UTM:', e.message); return { campaigns: [] }; }),
    ]);

    // GAM UTM lookup by day: byDay['yyyy-mm-dd']['utm'] → { revenue, impressions, ecpm }
    const gamByDay = gamFunnels?.byDay || {};

    // ── Process Meta ads ──────────────────────────
    const pendingPrefixes = new Map(); // prefix → example campaign name
    const adsForGrouping = [];

    for (const ad of metaAds) {
      const prefix = extractDomainPrefix(ad.campaign_name);
      if (!prefix) continue;

      const domain = domainByPrefix[prefix.toUpperCase()];
      if (!domain) {
        if (!pendingPrefixes.has(prefix)) {
          pendingPrefixes.set(prefix, ad.campaign_name);
        }
        continue;
      }

      const adUTM = extractAdUTM(ad.ad_name);
      if (!adUTM) continue;

      // Use ad's own date_start (from time_increment:1) for accurate per-day data
      const adDate = ad.date_start || until;

      const spend = Number(ad.spend || 0);
      const resultado = getResultadoMeta(ad);

      if (adUTM.toLowerCase() === 'zurifb') {
        console.log('[zurifb DEBUG]', {
          spend,
          clicks: Number(ad.clicks || 0),
          actions: ad.actions,
          objetivo: ad.objective || ad.optimization_goal,
          resultado_calculado: resultado,
          custo_resultado_calculado: resultado > 0 ? +(spend / resultado).toFixed(4) : 0,
        });
      }

      adsForGrouping.push({
        adUTM,
        domainId: domain.id,
        tipo: extractTipo(ad.campaign_name),
        date: adDate,
        campaignName: ad.campaign_name,
        conjuntoMeta: ad.adset_name || null,
        accountId: ad._accountId || null,
        spend,
        clicks: Number(ad.clicks || 0),
        impressions: Number(ad.impressions || 0),
        results: resultado,
        cpc: Number(ad.cpc || 0),
        ctr: Number(ad.ctr || 0),
        adsetId: ad.adset_id || null,
        adsetBudget: ad._adsetBudget || 0,
      });
    }

    // Group ads by UTM+date (many "01-janefb", "02-janefb" → "janefb", per day)
    const grouped = groupAdsByUTM(adsForGrouping);

    // ── Build viewability map: date|domainId → viewability% (from GAM adUnitsByDay) ──
    const adUnitsByDay = gamReport?.adUnitsByDay || {};
    const viewByDomainDay = {};
    for (const [dayDate, unitMap] of Object.entries(adUnitsByDay)) {
      const domTotals = {}; // domainId → { viewable, measurable }
      for (const [unitName, u] of Object.entries(unitMap)) {
        let domainId = dominios[0].id;
        const unitLower = unitName.toLowerCase();
        for (const d of dominios) {
          if (d.codigo_pedido_gam) {
            const pfx = d.codigo_pedido_gam.split('-')[0].toLowerCase() + '_';
            if (unitLower.startsWith(pfx)) { domainId = d.id; break; }
          }
        }
        if (!domTotals[domainId]) domTotals[domainId] = { v: 0, m: 0 };
        domTotals[domainId].v += u.viewable || 0;
        domTotals[domainId].m += u.measurable || 0;
      }
      for (const [domId, vm] of Object.entries(domTotals)) {
        viewByDomainDay[`${dayDate}|${domId}`] = vm.m > 0 ? (vm.v / vm.m) * 100 : 0;
      }
    }

    // ── Build ads_consolidados upsert rows ────────
    const adsRows = [];
    for (const g of grouped) {
      const dayGam = gamByDay[g.date] || {};
      const utmKey = g.adUTM.toLowerCase();
      // DIRETO campaigns: Meta ad name includes "-direto-" but GAM utm_campaign omits it
      // e.g. "relamad-australia-direto-fb" → try "relamad-australia-fb" as fallback
      const utmKeyNoDireto = utmKey.replace(/-direto-?/, '-').replace(/-$/, '');
      const gam = dayGam[utmKey] || dayGam[utmKeyNoDireto] || {};
      const faturamentoBruto = gam.revenue || 0;
      // Taxa 10% aplicada AQUI. Não aplicar de novo no frontend nem nas rotas de API.
      if (g.tipo === 'direto') {
        const availKeys = Object.keys(dayGam);
        const matched = dayGam[utmKey] ? utmKey : (dayGam[utmKeyNoDireto] ? utmKeyNoDireto : 'NONE');
        console.log(`[DIRETO] date=${g.date} utm="${g.adUTM}" key="${utmKey}" noDireto="${utmKeyNoDireto}" GAMkeys=[${availKeys.join(',')}] matched="${matched}" fat=${faturamentoBruto.toFixed(4)} imp=${gam.impressions || 0}`);
      }
      const faturamentoReal = faturamentoBruto * 0.9;
      // Aplicar imposto ao investimento Meta
      const impostoPerc = g.accountId ? (impostoMap[g.accountId] || 0) : 0;
      const fatorImposto = 1 + (impostoPerc / 100);
      const valorGastoOriginal = g.spend;
      const valorGastoComImposto = valorGastoOriginal * fatorImposto;
      const lucro = faturamentoReal - valorGastoComImposto;
      const roas = valorGastoComImposto > 0 ? faturamentoReal / valorGastoComImposto : 0;
      const impressoesGam = gam.impressions || 0;
      const rps = impressoesGam > 0 ? faturamentoReal / impressoesGam : 0;
      const ecpm = gam.ecpm || 0;
      const custo = g.results > 0 ? valorGastoComImposto / g.results : 0;
      const cliquesGam = gam.cliques_gam || 0;
      const ctrGam = gam.ctr_gam || 0;
      const cpcGam = gam.cpc_gam || 0;

      // Previsão: only for today when we have partial data and a known budget
      const isThisToday = g.date === today();
      let prevImp = 0, prevFat = 0, prevFatReal = 0, prevLucro = 0, prevRoas = 0;
      if (isThisToday && g.clicks > 0 && g.cpc > 0 && g.orcamentoTotal > 0 && impressoesGam > 0) {
        const cliquesPrevistos = g.orcamentoTotal / g.cpc;
        const proporcao = impressoesGam / g.clicks;
        prevImp = Math.round(cliquesPrevistos * proporcao);
        prevFat = prevImp * (ecpm / 1000);
        prevFatReal = prevFat * 0.9;
        prevLucro = prevFatReal - g.orcamentoTotal;
        prevRoas = g.orcamentoTotal > 0 ? prevFatReal / g.orcamentoTotal : 0;
      }

      if (g.orcamentoTotal > 0) console.log(`[budget] date=${g.date} utm="${g.adUTM}" tipo=${g.tipo} orcamento=R$${(g.orcamentoTotal || 0).toFixed(2)}`);
      const cpcComImposto = g.clicks > 0 ? valorGastoComImposto / g.clicks : 0;
      adsRows.push({
        data: g.date,
        dominio_id: g.domainId,
        ad_utm: g.adUTM,
        campanha_meta: g.campaignName,
        tipo: g.tipo,
        account_id: g.accountId || null,
        valor_gasto_original: +valorGastoOriginal.toFixed(2),
        valor_gasto: +valorGastoComImposto.toFixed(2),
        imposto_aplicado: impostoPerc,
        custo_resultado: +custo.toFixed(2),
        resultado: g.results,
        cpc: +cpcComImposto.toFixed(4),
        ctr: +g.ctr.toFixed(2),
        cliques: g.clicks,
        impressoes_gam: impressoesGam,
        viewability: +(viewByDomainDay[`${g.date}|${g.domainId}`] || 0).toFixed(2),
        ecpm: +ecpm.toFixed(2),
        rps: +rps.toFixed(4),
        faturamento_bruto: +faturamentoBruto.toFixed(2),
        faturamento_real: +faturamentoReal.toFixed(2),
        lucro: +lucro.toFixed(2),
        roas: +roas.toFixed(4),
        // fallback upsert ignores unknown cols via try/catch in the block below
        orcamento_total: +(g.orcamentoTotal || 0).toFixed(2),
        previsao_impressoes: prevImp,
        previsao_faturamento: +prevFat.toFixed(2),
        previsao_faturamento_real: +prevFatReal.toFixed(2),
        previsao_lucro: +prevLucro.toFixed(2),
        previsao_roas: +prevRoas.toFixed(4),
        cpc_gam: +cpcGam.toFixed(4),
        ctr_gam: +ctrGam.toFixed(2),
        cliques_gam: cliquesGam,
        updated_at: new Date().toISOString(),
      });
    }

    if (adsRows.length > 0) {
      let { error: uErr } = await supabase
        .from('ads_consolidados')
        .upsert(adsRows, { onConflict: 'data,dominio_id,ad_utm' });
      if (uErr && uErr.message.toLowerCase().includes('could not find')) {
        // New columns not yet migrated — retry without them
        const fallback = adsRows.map(({ cpc_gam, ctr_gam, cliques_gam, account_id, valor_gasto_original, imposto_aplicado, ...rest }) => rest);
        ({ error: uErr } = await supabase
          .from('ads_consolidados')
          .upsert(fallback, { onConflict: 'data,dominio_id,ad_utm' }));
        if (!uErr) console.warn('[sync] upserted without new columns — run ALTER TABLE migration');
      }
      if (uErr) console.error('[sync] upsert ads_consolidados:', uErr.message);
      rowsProcessed += adsRows.length;
    }

    // ── Insert pending domains ────────────────────
    for (const [prefix, exCampaign] of pendingPrefixes) {
      const { error: pErr } = await supabase
        .from('dominios_pendentes')
        .upsert(
          { prefixo_detectado: prefix, exemplo_nome_campanha: exCampaign, primeira_deteccao: new Date().toISOString() },
          { onConflict: 'prefixo_detectado' }
        );
      if (pErr) console.error('[sync] dominios_pendentes:', pErr.message);
    }

    // ── Upsert blocos_anuncio (per day, from adUnitsByDay) ────
    if (Object.keys(adUnitsByDay).length && dominios?.length) {
      for (const [dayDate, unitMap] of Object.entries(adUnitsByDay)) {
        const blocosRows = [];
        for (const [unitName, u] of Object.entries(unitMap)) {
          // Match domain by codigo_pedido_gam prefix: "MKU-AdX" → "mku_"
          let domainId = dominios[0].id;
          const unitLower = unitName.toLowerCase();
          for (const d of dominios) {
            if (d.codigo_pedido_gam) {
              const prefix = d.codigo_pedido_gam.split('-')[0].toLowerCase() + '_';
              if (unitLower.startsWith(prefix)) { domainId = d.id; break; }
            }
          }
          const dayImp = u.impressions || 0;
          const dayRev = u.revenue || 0;
          const dayEcpm = dayImp > 0 ? (dayRev / dayImp) * 1000 : 0;
          const taxaProg = u.impressions > 0 ? (u.adxImpressions / u.impressions) * 100 : 0;
          blocosRows.push({
            data: dayDate,
            dominio_id: domainId,
            nome_bloco: unitName,
            impressoes: dayImp,
            total_clicks: u.clicks || 0,
            receita_total: +dayRev.toFixed(2),
            ecpm_medio: +dayEcpm.toFixed(2),
            taxa_correspondencia_programatica: +taxaProg.toFixed(2),
            updated_at: new Date().toISOString(),
          });
        }
        if (blocosRows.length) {
          await supabase.from('blocos_anuncio').delete().eq('data', dayDate);
          const { error: bErr } = await supabase.from('blocos_anuncio').insert(blocosRows);
          if (bErr) console.error(`[sync] insert blocos_anuncio ${dayDate}:`, bErr.message);
          rowsProcessed += blocosRows.length;
        }
      }
    }

    // ── Log success ───────────────────────────────
    const duration = Date.now() - startMs;
    await supabase.from('sync_log').insert({
      source: 'syncAll',
      status: 'success',
      message: `${adsRows.length} ads upserted, ${pendingPrefixes.size} domínios pendentes`,
      rows_processed: rowsProcessed,
      duration_ms: duration,
    });

    console.log(`[sync] OK — ${adsRows.length} ads (${since}→${until}), ${pendingPrefixes.size} pending, ${duration}ms`);
    return { success: true, rowsProcessed, pendingDomains: [...pendingPrefixes.keys()], durationMs: duration };

  } catch (err) {
    const duration = Date.now() - startMs;
    console.error('[syncAll]', err.message);
    try {
      await supabase.from('sync_log').insert({
        source: 'syncAll',
        status: 'error',
        message: err.message,
        rows_processed: rowsProcessed,
        duration_ms: duration,
      });
    } catch { /* ignore log failure */ }
    throw err;
  }
}

module.exports = { syncAll };
