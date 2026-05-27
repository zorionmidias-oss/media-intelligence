'use strict';
const axios = require('axios');
const supabase = require('./supabase');
const { getBMConfigs, updateBMStatus } = require('./meta');
const { fetchGAMReport, fetchGAMFunnelsByUTM, getUSDtoBRL, getUSDtoBRLByDate, fetchGAMHourly, fetchGAMUtmCampaigns, fetchGAMUtmSources } = require('./gam');
const { extractDomainPrefix, extractAdUTM, extractTipo, groupAdsByUTM, extractPaisSigla, extractNicho, PAISES } = require('./parser');

const BASE = 'https://graph.facebook.com/v19.0';
const AD_FIELDS = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,outbound_clicks,clicks,ctr,cpc,actions,objective,optimization_goal';

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
  // BUG 5: landing_page_view e omni_landing_page_view são o mesmo evento (alias).
  // Usar APENAS o primeiro encontrado — nunca somar. Ordem garante fallback sem duplicar.
  'OUTCOME_TRAFFIC':    ['landing_page_view', 'omni_landing_page_view', 'link_click'],
  'LINK_CLICKS':        ['landing_page_view', 'omni_landing_page_view', 'link_click'],
  'PAGE_VIEW':          ['landing_page_view', 'omni_landing_page_view'],
  'OUTCOME_AWARENESS':  ['impressions'],
  'OUTCOME_ENGAGEMENT': ['post_engagement'],
};

// BUG 2: Para campanhas BOT o objetivo é "Visualização de conteúdo" = view_content na API.
// NÃO é landing_page_view (que não existe nessas campanhas).
// view_content, omni_view_content e offsite_conversion.fb_pixel_view_content têm o mesmo valor
// — usar somente o primeiro encontrado, NUNCA somar.
function getResultadoMeta(ad, tipo) {
  const actions = ad.actions || [];

  if (tipo === 'bot') {
    const vc = actions.find(a => a.action_type === 'view_content');
    if (vc) return Number(vc.value);
    const ovc = actions.find(a => a.action_type === 'omni_view_content');
    if (ovc) return Number(ovc.value);
    const fpvc = actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_view_content');
    if (fpvc) return Number(fpvc.value);
    return 0;
  }

  // Direto e demais: usa mapa de objetivo do Meta
  const objetivo = ad.objective || ad.optimization_goal;
  const expected = OBJECTIVE_ACTION_MAP[objetivo] || ['link_click'];
  for (const type of expected) {
    const found = actions.find(a => a.action_type === type);
    if (found) return Number(found.value);
  }
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

// Returns the UTC offset (in whole hours) for an IANA timezone on a given date.
// e.g. 'America/Los_Angeles' on a PDT day → -7; 'America/Sao_Paulo' in BRT → -3
function tzOffsetHours(dateStr, timezone) {
  const ref = new Date(`${dateStr}T12:00:00Z`); // noon UTC on that date
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false })
      .formatToParts(ref)
      .find(p => p.type === 'hour')?.value ?? '12',
    10
  );
  return (localHour === 24 ? 0 : localHour) - 12;
}

// ─────────────────────────────────────────────
// Fetch real currency and timezone_name from Meta API and update meta_accounts.
// Returns { [act_XXX]: { currency, timezone_name } } for all active accounts.
async function refreshMetaAccountInfo() {
  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('id,ad_account_id,access_token')
    .eq('ativo', true);

  const infoMap = {};
  for (const acc of accounts || []) {
    if (!acc.access_token) continue;
    const accountId = String(acc.ad_account_id).startsWith('act_')
      ? String(acc.ad_account_id)
      : `act_${acc.ad_account_id}`;
    try {
      const res = await axios.get(`${BASE}/${accountId}`, {
        params: { access_token: acc.access_token, fields: 'currency,timezone_name' },
        timeout: 15000,
      });
      const { currency, timezone_name } = res.data || {};
      if (currency) {
        infoMap[accountId] = { currency, timezone_name: timezone_name || null };
        await supabase.from('meta_accounts')
          .update({ moeda: currency, timezone_name: timezone_name || null })
          .eq('id', acc.id);
        console.log(`[meta refresh] ${accountId}: currency=${currency} tz=${timezone_name}`);
      }
    } catch (e) {
      console.warn(`[meta refresh ${accountId}]`, e.response?.data?.error?.message || e.message);
    }
  }
  return infoMap;
}

// Hourly Meta spend: returns { [hora]: investimento_brl } for a given date.
// Calls Meta API with hourly breakdown per account, converts to BRL with
// imposto/câmbio, aggregates all accounts.
async function fetchMetaHourlySpend(date) {
  // Always get real currency from Meta API — never trust DB cache for moeda
  const apiInfo = await refreshMetaAccountInfo().catch(e => {
    console.warn('[hourly Meta] refreshMetaAccountInfo:', e.message);
    return {};
  });

  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('ad_account_id,access_token,imposto_percentual,moeda')
    .eq('ativo', true);

  const horaMap = {}; // hora (0-23) → total investimento_brl

  for (const acc of accounts || []) {
    const { ad_account_id, access_token: token, imposto_percentual } = acc;
    if (!token) continue;
    const accountId = String(ad_account_id).startsWith('act_') ? String(ad_account_id) : `act_${ad_account_id}`;
    const fatorImposto = 1 + (Number(imposto_percentual || 0) / 100);
    // API-verified currency takes precedence over DB moeda
    const moeda = apiInfo[accountId]?.currency || acc.moeda || 'BRL';
    let taxaUSD = 1;
    if (moeda === 'USD') {
      taxaUSD = await getUSDtoBRLByDate(date).catch(() => 1);
    }

    // Compute shift: account TZ hour → BRT hour
    const accountTz = apiInfo[accountId]?.timezone_name || 'America/Sao_Paulo';
    const acctOffset = tzOffsetHours(date, accountTz);        // e.g. -7 for LA PDT
    const brtOffset  = tzOffsetHours(date, 'America/Sao_Paulo'); // e.g. -3 for BRT
    const hourShift  = brtOffset - acctOffset; // e.g. +4 for LA → BRT

    try {
      const res = await axios.get(`${BASE}/${accountId}/insights`, {
        params: {
          access_token: token,
          level: 'account',
          fields: 'spend',
          time_range: JSON.stringify({ since: date, until: date }),
          breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
          limit: 50,
        },
        timeout: 30000,
      });
      for (const row of res.data?.data || []) {
        const hStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
        // Format: "00:00:00 - 01:00:00" — extract leading hour in account TZ
        const acctHour = parseInt(hStr.slice(0, 2), 10);
        if (isNaN(acctHour) || acctHour < 0 || acctHour > 23) continue;
        const brtHour = acctHour + hourShift;
        // Skip hours that cross into the adjacent BRT day
        if (brtHour < 0 || brtHour > 23) continue;
        const spend = Number(row.spend || 0);
        horaMap[brtHour] = (horaMap[brtHour] || 0) + spend * taxaUSD * fatorImposto;
      }
      if (hourShift !== 0) {
        console.log(`[hourly Meta ${accountId}] tz=${accountTz} shift=${hourShift > 0 ? '+' : ''}${hourShift}h`);
      }
    } catch (e) {
      console.warn(`[hourly Meta ${accountId}]`, e.response?.data?.error?.message || e.message);
    }
  }

  const totalHoras = Object.keys(horaMap).length;
  const totalSpend = Object.values(horaMap).reduce((s, v) => s + v, 0);
  console.log(`[hourly Meta] ${date}: ${totalHoras} horas, investimento total R$${totalSpend.toFixed(2)}`);
  if (totalHoras > 0) {
    console.log('[hourly Meta] spend por hora BRT:', JSON.stringify(
      Object.fromEntries(Object.entries(horaMap).map(([h, v]) => [h, +v.toFixed(2)]))
    ));
  }
  return horaMap;
}

// Fetch GAM + Meta hourly data for one date and upsert into dados_hora.
async function fetchAndSaveHourly(date) {
  const [gamRows, metaHoraMap] = await Promise.all([
    fetchGAMHourly({ since: date, until: date }).catch(e => { console.warn('[hourly GAM]', e.message); return []; }),
    fetchMetaHourlySpend(date).catch(e => { console.warn('[hourly Meta]', e.message); return {}; }),
  ]);

  const gamMap = {};
  for (const h of gamRows) gamMap[h.hora] = h;

  const rows = [];
  for (let hora = 0; hora < 24; hora++) {
    const gam = gamMap[hora];
    const inv = +(metaHoraMap[hora] || 0).toFixed(4);
    const rec = gam?.receita || 0;
    const imp = gam?.impressoes || 0;
    if (rec === 0 && inv === 0 && imp === 0) continue;
    const ecpm = gam?.ecpm || (imp > 0 ? +((rec / imp) * 1000).toFixed(4) : 0);
    const recLiq = rec * 0.9;
    // Threshold: investimento < R$1 pode ser artefato de distribuição horária — ROI nulo nesses casos
    const roi = inv >= 1 ? +((recLiq - inv) / inv * 100).toFixed(4) : 0;
    rows.push({
      data: date, hora, dominio_id: 0,
      receita_bruta:    +rec.toFixed(4),
      impressoes:       imp,
      ecpm:             +ecpm.toFixed(4),
      investimento_brl: inv,
      roi,
      atualizado_em:    new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    console.log(`[hourly] sem dados para ${date}`);
    return 0;
  }

  const { error } = await supabase.from('dados_hora')
    .upsert(rows, { onConflict: 'data,hora,dominio_id' });
  if (error) console.warn(`[hourly] upsert ${date}:`, error.message);
  else console.log(`[hourly] ${rows.length} horas salvas → ${date}`);
  return rows.length;
}

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
      .select('id,nome,prefixo_campanha,codigo_pedido_gam,prefixo_ad_unit')
      .eq('ativo', true);

    // Always refresh Meta account info from API so moedaMap never uses stale DB values
    await refreshMetaAccountInfo().catch(e => console.warn('[sync] refreshMetaAccountInfo:', e.message));

    // BUG 1: Carregar imposto E moeda por conta Meta
    const { data: metaAccountsData } = await supabase
      .from('meta_accounts')
      .select('ad_account_id,imposto_percentual,moeda');
    const impostoMap = {};
    const moedaMap = {};
    for (const acc of metaAccountsData || []) {
      // Normalize to act_ prefix — fetchMetaAdsForSync always stores _accountId as act_XXXX
      const rawId = String(acc.ad_account_id || '');
      const key = rawId.startsWith('act_') ? rawId : `act_${rawId}`;
      impostoMap[key] = Number(acc.imposto_percentual || 0);
      moedaMap[key] = acc.moeda || 'BRL';
      console.log(`[sync] metaAccount key="${key}" moeda="${acc.moeda || 'BRL'}" imposto=${acc.imposto_percentual || 0}%`);
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
      // BUG 2: tipo calculado ANTES de getResultadoMeta para usar a lógica correta por tipo
      const tipo = extractTipo(ad.campaign_name);
      const resultado = getResultadoMeta(ad, tipo);

      // BUG 2 DEBUG: logar todos os ads de amafb do dia 16/05 para diagnóstico
      if (adUTM.toLowerCase() === 'amafb' && adDate === '2026-05-16') {
        console.log(`[DEBUG amafb 16/05]`);
        console.log(`  ad_id:`, ad.ad_id || ad.id);
        console.log(`  ad_name:`, ad.ad_name);
        console.log(`  spend:`, ad.spend);
        console.log(`  tipo:`, tipo);
        console.log(`  objective:`, ad.objective || ad.optimization_goal);
        console.log(`  actions:`, JSON.stringify(ad.actions, null, 2));
        console.log(`  landing_page_view:`, ad.actions?.find(a => a.action_type === 'landing_page_view')?.value);
        console.log(`  omni_landing_page_view:`, ad.actions?.find(a => a.action_type === 'omni_landing_page_view')?.value);
        console.log(`  resultado_calculado:`, resultado);
      }

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

      const paisSigla = extractPaisSigla(ad.adset_name) || extractPaisSigla(ad.campaign_name) || '';
      const nicho = extractNicho(ad.adset_name, ad.campaign_name);
      adsForGrouping.push({
        adUTM,
        domainId: domain.id,
        tipo,
        date: adDate,
        campaignName: ad.campaign_name,
        conjuntoMeta: ad.adset_name || null,
        accountId: ad._accountId || null,
        paisSigla,
        nicho,
        spend,
        clicks: Number(ad.inline_link_clicks || 0),
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
    let adsRows = [];
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

      const moeda = g.accountId ? (moedaMap[g.accountId] || 'BRL') : 'BRL';
      let taxaAplicada = 1;
      let valorEmBRL = g.spend;
      if (moeda === 'USD') {
        taxaAplicada = await getUSDtoBRLByDate(g.date);
        valorEmBRL = g.spend * taxaAplicada;
      }
      if (g.adUTM.toLowerCase() === 'aishafb') {
        console.log(`[sync aishafb] accountId="${g.accountId}" moeda="${moeda}" spend=${g.spend} taxa=${taxaAplicada} valorBRL=${valorEmBRL.toFixed(4)}`);
      }

      const impostoPerc = g.accountId ? (impostoMap[g.accountId] || 0) : 0;
      const fatorImposto = 1 + (impostoPerc / 100);
      const valorGastoOriginal = g.spend;
      const valorGastoComImposto = valorEmBRL * fatorImposto;
      const lucro = faturamentoReal - valorGastoComImposto;
      const roas = valorGastoComImposto > 0 ? faturamentoReal / valorGastoComImposto : 0;
      const impressoesGam = gam.impressions || 0;
      const rps = impressoesGam > 0 ? faturamentoReal / impressoesGam : 0;
      // eCPM: usar receita bruta / impressões (não gam.ecpm que é média simples de ad units)
      const ecpm = impressoesGam > 0 ? +((faturamentoBruto / impressoesGam) * 1000).toFixed(2) : 0;
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
      const gPaisSigla = g.paisSigla || '';
      const gPaisNome = (PAISES[gPaisSigla] || {}).nome || '';
      adsRows.push({
        data: g.date,
        dominio_id: g.domainId,
        ad_utm: g.adUTM,
        campanha_meta: g.campaignName,
        tipo: g.tipo,
        account_id: g.accountId || null,
        pais_sigla: gPaisSigla,
        pais_nome: gPaisNome,
        nicho: g.nicho || null,
        moeda_original: moeda,
        taxa_usd_aplicada: +taxaAplicada.toFixed(4),
        valor_gasto_original: +valorGastoOriginal.toFixed(4),
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
      // Deduplicate: remove zero-spend shadow rows for UTMs where another account
      // has actual spend on the same date+domain. Prevents double-counting GAM revenue.
      const utmsWithSpend = new Set(
        adsRows.filter(r => (r.valor_gasto || 0) > 0)
          .map(r => `${r.data}|${r.dominio_id}|${r.ad_utm}`)
      );
      const beforeDedup = adsRows.length;
      adsRows = adsRows.filter(r =>
        (r.valor_gasto || 0) > 0 || !utmsWithSpend.has(`${r.data}|${r.dominio_id}|${r.ad_utm}`)
      );
      if (adsRows.length < beforeDedup) {
        console.log(`[sync] removidas ${beforeDedup - adsRows.length} linhas UTM sem investimento (shadow de outra conta)`);
      }
    }

    if (adsRows.length > 0) {
      // BUG 3: pular datas que foram corrigidas manualmente
      const datas = [...new Set(adsRows.map(r => r.data))];
      let fixedRows = [];
      try {
        const { data: fr } = await supabase
          .from('ads_consolidados')
          .select('data')
          .in('data', datas)
          .eq('manually_fixed', true);
        fixedRows = fr || [];
      } catch (e) {
        console.warn('[sync] manually_fixed check failed:', e.message);
        fixedRows = [];
      }
      const fixedSet = new Set(fixedRows.map(r => r.data));
      if (fixedSet.size > 0) {
        const antes = adsRows.length;
        adsRows = adsRows.filter(r => !fixedSet.has(r.data));
        console.log(`[cron] ${fixedSet.size} data(s) com manually_fixed=true, pulando ${antes - adsRows.length} linhas: ${[...fixedSet].join(', ')}`);
      }
    }

    if (adsRows.length > 0) {
      let { error: uErr } = await supabase
        .from('ads_consolidados')
        .upsert(adsRows, { onConflict: 'data,dominio_id,ad_utm,account_id,pais_sigla' });
      if (uErr && uErr.message.toLowerCase().includes('could not find')) {
        // New columns not yet migrated — retry without them
        const fallback = adsRows.map(({ cpc_gam, ctr_gam, cliques_gam, account_id, valor_gasto_original, imposto_aplicado, moeda_original, taxa_usd_aplicada, pais_sigla, pais_nome, nicho, ...rest }) => rest);
        ({ error: uErr } = await supabase
          .from('ads_consolidados')
          .upsert(fallback, { onConflict: 'data,dominio_id,ad_utm,account_id,pais_sigla' }));
        if (!uErr) console.warn('[sync] upserted without new columns — run ALTER TABLE migration');
      }
      if (uErr) console.error('[sync] upsert ads_consolidados:', uErr.message);
      rowsProcessed += adsRows.length;

      // Clean up ghost rows: pais_sigla='' entries that now have a real country counterpart
      if (!uErr) {
        const seen = new Set();
        const toClean = adsRows.filter(r => {
          if (!r.pais_sigla) return false;
          const k = `${r.data}|${r.dominio_id}|${r.ad_utm}|${r.account_id || ''}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        for (const r of toClean) {
          let q = supabase.from('ads_consolidados').delete()
            .eq('data', r.data)
            .eq('dominio_id', r.dominio_id)
            .eq('ad_utm', r.ad_utm)
            .eq('pais_sigla', '');
          q = r.account_id ? q.eq('account_id', r.account_id) : q.is('account_id', null);
          const { error: delErr } = await q;
          if (delErr) console.error('[sync] ghost cleanup:', delErr.message);
        }
        if (toClean.length > 0) console.log(`[sync] cleaned ${toClean.length} ghost pais_sigla='' entries`);
      }
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

    // ── Popular cache de Reports GAM em background ──
    try {
      const [hourly, utmCampaigns, utmSources] = await Promise.all([
        fetchGAMHourly({ since: until, until }).catch(e => { console.warn('[sync] GAM hourly cache:', e.message); return []; }),
        fetchGAMUtmCampaigns({ since: until, until }).catch(e => { console.warn('[sync] GAM utm cache:', e.message); return []; }),
        fetchGAMUtmSources({ since: until, until }).catch(e => { console.warn('[sync] GAM src cache:', e.message); return []; }),
      ]);

      const now = new Date().toISOString();
      const pfx = dominios?.[0]?.prefixo_ad_unit || '';

      if (hourly.length > 0) {
        const { error: rHoraErr } = await supabase.from('report_hora')
          .upsert(
            hourly.map(h => ({
              data: until,
              hora: h.hora,
              impressoes: h.impressoes || 0,
              nao_preenchidas: h.nao_preenchidas || 0,
              receita: h.receita || 0,
              ecpm: h.ecpm || 0,
              ctr: h.ctr || 0,
              cliques: h.cliques || 0,
              cpc: h.cpc || 0,
              prefixo_ad_unit: pfx,
              updated_at: now,
            })),
            { onConflict: 'data,hora,prefixo_ad_unit' }
          );
        if (rHoraErr) console.warn('[sync] upsert report_hora:', rHoraErr.message);
        else console.log(`[sync] cache GAM: ${hourly.length} horas salvas`);
      }

      if (utmCampaigns.length > 0) {
        const { error: utmErr } = await supabase.from('report_utm_campaign')
          .upsert(
            utmCampaigns.map(u => ({
              data: until,
              utm_campaign: u.utm_campaign,
              dominio_id: 0,
              impressoes: u.impressoes || 0,
              receita: u.receita || 0,
              ecpm: u.ecpm || 0,
              ctr: u.ctr || 0,
              cliques: u.cliques || 0,
              cpc: u.cpc || 0,
              prefixo_ad_unit: pfx,
              updated_at: now,
            })),
            { onConflict: 'data,utm_campaign,dominio_id' }
          );
        if (utmErr) console.warn('[sync] upsert report_utm_campaign:', utmErr.message);
        else console.log(`[sync] cache GAM: ${utmCampaigns.length} UTMs salvas`);
      }

      if (utmSources.length > 0) {
        const { error: rSrcErr } = await supabase.from('report_utm_source')
          .upsert(
            utmSources.map(u => ({
              data: until,
              utm_source: u.utm_source || u.utm_campaign,
              impressoes: u.impressoes || 0,
              receita: u.receita || 0,
              ecpm: u.ecpm || 0,
              cliques: u.cliques || 0,
              prefixo_ad_unit: pfx,
              updated_at: now,
            })),
            { onConflict: 'data,utm_source,prefixo_ad_unit' }
          );
        if (rSrcErr) console.warn('[sync] upsert report_utm_source:', rSrcErr.message);
        else console.log(`[sync] cache GAM: ${utmSources.length} sources salvas`);
      }
    } catch (e) {
      console.warn('[sync] GAM cache background:', e.message);
      // Não deixar falhar o sync principal por causa do cache
    }

    // ── Salvar dados horários para o gráfico intraday ────────────────────────
    try {
      await fetchAndSaveHourly(until);
      if (since !== until) await fetchAndSaveHourly(since);
    } catch (e) {
      console.warn('[sync] hourly save:', e.message);
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

module.exports = { syncAll, fetchAndSaveHourly };
