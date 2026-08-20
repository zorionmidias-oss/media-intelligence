'use strict';
const axios = require('axios');
const { DateTime } = require('luxon');
const supabase = require('./supabase');
const { getBMConfigs, updateBMStatus } = require('./meta');
const { fetchGAMReport, fetchGAMFunnelsByUTM, fetchGAMHourlyByDomain, fetchGAMUtmCampaigns, fetchGAMUtmSources } = require('./gam');
const { getUSDtoBRL, getUSDtoBRLByDate } = require('../services/exchange.service');
const { findAction, getResults, OBJECTIVE_ACTION_MAP, getResultadoMeta } = require('../services/attribution.service');
const { extractDomainPrefix, extractAdUTM, extractTipo, groupAdsByUTM, extractPaisSigla, extractNicho, resolveCountry } = require('./parser');
const { converterHoraParaBR } = require('./fuso');

const BASE = 'https://graph.facebook.com/v19.0';
const AD_FIELDS = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,outbound_clicks,clicks,ctr,cpc,actions,objective,optimization_goal';
// A Meta rejeita `actions` combinado com breakdown horário em contas com muitos ads
// (400 subcode 1504038 "Sua solicitação expirou") — versão sem actions para essas queries
const AD_FIELDS_NO_ACTIONS = AD_FIELDS.replace(',actions', '');

// "Hoje" do negócio é SEMPRE fuso BR — new Date().toISOString() é UTC e a
// partir das 21h BRT viraria amanhã (sync passava a rotular/pedir o dia errado)
const { hojeBR, diasAtrasBR } = require('./datas');
function today() {
  return hojeBR();
}

// Busca paginada de insights da Meta; lança em caso de erro HTTP.
async function fetchInsightsPaginated(url, params) {
  const rows = [];
  let reqUrl = url;
  let reqParams = params;
  while (reqUrl) {
    const res = await axios.get(reqUrl, { params: reqParams, timeout: 60000 });
    const page = res.data?.data || [];
    rows.push(...page);
    reqUrl = page.length > 0 ? (res.data?.paging?.next || null) : null;
    reqParams = undefined; // URL paginada já carrega os params
  }
  return rows;
}

// Busca o range completo em uma chamada; se a Meta rejeitar por volume (400 "Sua solicitação
// expirou"), cai para uma chamada por dia com um retry. Tudo-ou-nada: se um dia falhar mesmo
// após retry, lança — quem chama aborta a conta inteira para não gravar gasto parcial.
async function fetchInsightsWithDayFallback(accountId, params, { since, until }) {
  const url = `${BASE}/${accountId}/insights`;
  try {
    return await fetchInsightsPaginated(url, { ...params, time_range: JSON.stringify({ since, until }) });
  } catch (e) {
    if (e.response?.status !== 400) throw e;
    const sub = e.response?.data?.error?.error_subcode;
    console.warn(`[sync Meta ${accountId}] range ${since}→${until} rejeitado (400/${sub}) — fallback dia a dia`);
    const rows = [];
    let cur = DateTime.fromISO(since);
    const end = DateTime.fromISO(until);
    while (cur <= end) {
      const dayParams = { ...params, time_range: JSON.stringify({ since: cur.toISODate(), until: cur.toISODate() }) };
      try {
        rows.push(...await fetchInsightsPaginated(url, dayParams));
      } catch {
        await new Promise(r => setTimeout(r, 3000));
        rows.push(...await fetchInsightsPaginated(url, dayParams));
      }
      cur = cur.plus({ days: 1 });
    }
    return rows;
  }
}


// Fetch all ads with insights for every configured BM account
async function fetchMetaAdsForSync(dateRange) {
  const configs = await getBMConfigs();
  const since = dateRange?.since || today();
  const until = dateRange?.until || today();

  // Buscar timezone_name de todas as contas — necessário para re-bucketing por fuso BR
  const { data: tzRows } = await supabase
    .from('meta_accounts')
    .select('ad_account_id,timezone_name')
    .eq('ativo', true);
  const tzMap = {};
  for (const r of tzRows || []) {
    const k = String(r.ad_account_id).startsWith('act_')
      ? String(r.ad_account_id) : `act_${r.ad_account_id}`;
    tzMap[k] = r.timezone_name || null;
  }

  const allAds = [];
  const failedBMs = []; // contas cujo fetch falhou — dados delas ficam defasados no banco
  const failedAccounts = []; // ids das contas acima — a poda NUNCA roda em conta que falhou
  const budgetByAccount = {}; // accountId → Map(campaignId → budget)

  for (const config of configs) {
    try {
      const { token, account } = config;
      const accountId = account.startsWith('act_') ? account : `act_${account}`;
      const accountTz = tzMap[accountId] || 'America/Sao_Paulo';
      const needsRebucket = accountTz !== 'America/Sao_Paulo';
      // Range alargado para cobrir o dia BR completo quando a conta está em outro fuso
      const fetchSince = needsRebucket
        ? DateTime.fromISO(since, { zone: 'America/Sao_Paulo' }).minus({ days: 1 }).toISODate()
        : since;
      const fetchUntil = needsRebucket
        ? DateTime.fromISO(until, { zone: 'America/Sao_Paulo' }).plus({ days: 1 }).toISODate()
        : until;

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
      const adsetRows = adsetBudgetRes.data?.data || [];
      // CBO: orçamento é da campanha — dividir igualmente entre os adsets para a soma
      // por adset não multiplicar o budget da campanha
      const adsetsPorCampanha = {};
      for (const a of adsetRows) {
        adsetsPorCampanha[a.campaign_id] = (adsetsPorCampanha[a.campaign_id] || 0) + 1;
      }
      const budgetMap = new Map();
      for (const a of adsetRows) {
        const rawDaily = Number(a.daily_budget || 0);
        const rawLt = Number(a.lifetime_budget || 0);
        let budget = 0;
        if (rawDaily > 0) {
          budget = rawDaily / 100;
        } else if (rawLt > 0) {
          budget = (rawLt / 100) / 30; // lifetime ÷ 30d estimate
        } else {
          const campBudget = campBudgetMap.get(a.campaign_id) || 0; // CBO fallback
          budget = campBudget / (adsetsPorCampanha[a.campaign_id] || 1);
        }
        if (budget > 0) budgetMap.set(a.id, budget);
      }
      budgetByAccount[accountId] = budgetMap;

      // Paginated fetch de insights: breakdown horário para contas fora do BR,
      // fetch diário simples para contas já em fuso BR (otimização Render free tier)
      const baseParams = { access_token: token, level: 'ad', time_increment: 1, limit: 500 };
      const fetchRange = { since: fetchSince, until: fetchUntil };

      let insightRows;          // métricas (horárias p/ rebucket, diárias caso contrário)
      let actionsByAdDay = null; // `${ad_id}|${date}` → actions[] (só rebucket)
      if (needsRebucket) {
        // A Meta rejeita `actions` + breakdown horário nesta escala → duas queries:
        // 1) métricas horárias sem actions (re-bucketing exato de gasto/cliques/impressões)
        insightRows = await fetchInsightsWithDayFallback(accountId, {
          ...baseParams,
          fields: AD_FIELDS_NO_ACTIONS,
          breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
        }, fetchRange);
        // 2) actions em granularidade diária (leve). Aproximação: o dia do fuso do anunciante
        //    é atribuído ao mesmo rótulo de data BR (20 das 24h coincidem em contas LA)
        const actionRows = await fetchInsightsWithDayFallback(accountId, {
          ...baseParams,
          fields: 'ad_id,actions',
        }, fetchRange);
        actionsByAdDay = {};
        for (const r of actionRows) {
          if (r.actions) actionsByAdDay[`${r.ad_id}|${r.date_start}`] = r.actions;
        }
      } else {
        insightRows = await fetchInsightsWithDayFallback(accountId, {
          ...baseParams,
          fields: AD_FIELDS,
        }, fetchRange);
      }

      // Acumulador para re-bucketing: `${ad_id}|${dataBR}` → row agregada por dia BR
      const hourlyAccum = new Map();

      for (const r of insightRows) {
        if (!needsRebucket) {
          r._bmId = config.id;
          r._accountId = accountId;
          r._adsetBudget = budgetMap.get(r.adset_id) || 0;
          allAds.push(r);
        } else {
          const hStr = r.hourly_stats_aggregated_by_advertiser_time_zone || '';
          const conv = converterHoraParaBR(r.date_start, hStr, accountTz);
          if (!conv) continue;
          const { dataBR } = conv;
          // Descartar horas cujo dia BR cai fora do range solicitado
          if (dataBR < since || dataBR > until) continue;

          const key = `${r.ad_id}|${dataBR}`;
          if (!hourlyAccum.has(key)) {
            // Primeira hora deste (ad, dataBR): copiar campos fixos do ad
            hourlyAccum.set(key, {
              ...r,
              date_start: dataBR,
              spend: 0,
              impressions: 0,
              inline_link_clicks: 0,
              outbound_clicks: 0,
              clicks: 0,
              ctr: 0,
              cpc: 0,
              _bmId: config.id,
              _accountId: accountId,
              _adsetBudget: budgetMap.get(r.adset_id) || 0,
            });
          }
          const acc = hourlyAccum.get(key);
          acc.spend              += Number(r.spend              || 0);
          acc.impressions        += Number(r.impressions        || 0);
          acc.inline_link_clicks += Number(r.inline_link_clicks || 0);
          acc.outbound_clicks    += Number(r.outbound_clicks    || 0);
          acc.clicks             += Number(r.clicks             || 0);
        }
      }

      // Materializar acumulador: anexar actions (da query diária) por dia BR, empurrar para allAds
      // findAction/getResultadoMeta roda UMA vez por linha em syncAll
      if (needsRebucket) {
        for (const [key, acc] of hourlyAccum) {
          const adId = key.slice(0, key.indexOf('|'));
          const dataBR = key.slice(key.indexOf('|') + 1);
          acc.actions = actionsByAdDay[`${adId}|${dataBR}`] || [];
          allAds.push(acc);
        }
      }

      await updateBMStatus(config.id, 'OK');
    } catch (e) {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.error(`[sync Meta BM${config.id}] status=${e.response?.status ?? 'N/A'} ${detail}`);
      failedBMs.push(`${config.nome || `BM${config.id}`} (${config.account}): ${e.response?.data?.error?.message || e.message}`);
      failedAccounts.push(config.account);
      await updateBMStatus(config.id, `ERR_${e.response?.status ?? 'N/A'}`, detail);
    }
  }

  return { ads: allAds, failedBMs, failedAccounts };
}

// converterHoraParaBR / tzOffsetHours agora vivem em ./fuso (compartilhado com
// o drilldown e a intraday por campanha) — importado no topo.

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
// Calls Meta API with hourly breakdown per campaign, converts to BRL.
// Returns { _global_: { hora→spend }, PREFIX: { hora→spend }, ... }
// _global_ é a soma de todas as campanhas — igual ao antigo account-level.
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

  const globalHoraMap = {}; // hora → total spend BRL (todas as campanhas)
  const prefixHoraMap = {}; // prefixo → { hora → spend BRL }
  let complete = true;      // false se a paginação de alguma conta falhar no meio

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
    const needsRebucket = accountTz !== 'America/Sao_Paulo';
    // Range alargado para trás para cobrir BR h00-03 (= LA h20-23 de ontem).
    // hrUntil = date (hoje): nenhuma hora BR de hoje vem de uma data LA futura,
    // então não há motivo para pedir amanhã (só infla a paginação / pede data futura).
    const hrSince = needsRebucket
      ? DateTime.fromISO(date, { zone: 'America/Sao_Paulo' }).minus({ days: 1 }).toISODate()
      : date;
    const hrUntil = date;
    if (needsRebucket) {
      console.log(`[hourly Meta ${accountId}] tz=${accountTz} — re-bucketing luxon para ${date}`);
    }

    try {
      let nextUrl = `${BASE}/${accountId}/insights`;
      let params = {
        access_token: token,
        level: 'campaign',
        fields: 'campaign_name,spend,date_start',
        time_range: JSON.stringify({ since: hrSince, until: hrUntil }),
        time_increment: 1,
        breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
        limit: 500,
      };
      while (nextUrl) {
        const res = await axios.get(nextUrl, { params, timeout: 30000 });
        params = undefined; // URL paginada já carrega os params — não reenviar
        for (const row of res.data?.data || []) {
          const hStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
          const conv = converterHoraParaBR(row.date_start || date, hStr, accountTz);
          if (!conv || conv.dataBR !== date) continue;
          const { horaBR } = conv;
          const spend = Number(row.spend || 0) * taxaUSD * fatorImposto;
          if (spend <= 0) continue;
          globalHoraMap[horaBR] = (globalHoraMap[horaBR] || 0) + spend;
          const prefix = extractDomainPrefix(row.campaign_name || '');
          if (prefix) {
            if (!prefixHoraMap[prefix]) prefixHoraMap[prefix] = {};
            prefixHoraMap[prefix][horaBR] = (prefixHoraMap[prefix][horaBR] || 0) + spend;
          }
        }
        nextUrl = res.data?.paging?.next || null;
      }
    } catch (e) {
      // Falha no meio da paginação → mapa parcial (faltam as horas mais recentes,
      // pois o Meta devolve as datas antigas primeiro). Marca incompleto para que
      // fetchAndSaveHourly NÃO zere as horas ausentes.
      complete = false;
      console.warn(`[hourly Meta ${accountId}] paginação incompleta:`, e.response?.data?.error?.message || e.message);
    }
  }

  const totalSpend = Object.values(globalHoraMap).reduce((s, v) => s + v, 0);
  console.log(`[hourly Meta] ${date}: ${Object.keys(globalHoraMap).length} horas, total R$${totalSpend.toFixed(2)}, complete=${complete}, prefixos: [${Object.keys(prefixHoraMap).join(', ')}]`);
  return { _global_: globalHoraMap, _complete: complete, ...prefixHoraMap };
}

// Busca ACTIONS por hora (resultado / conversas iniciadas / sessões view_content),
// SEPARADO do spend de propósito: se a Meta rejeitar actions+breakdown horário numa
// conta grande (400/1504038), só as métricas daquela conta somem no ciclo — o
// investimento (fetchMetaHourlySpend) nunca é afetado. Contas em fuso ≠ SP são
// re-bucketed por hora para o dia BR, igual ao spend.
async function fetchMetaHourlyActions(date) {
  const apiInfo = await refreshMetaAccountInfo().catch(() => ({}));
  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('ad_account_id,access_token')
    .eq('ativo', true);

  const globalMap = {};  // hora → { resultado, conversas, sessoes }
  const prefixMap = {};  // prefix → hora → { resultado, conversas, sessoes }
  let complete = true;

  const addTo = (map, hora, r, c, s) => {
    const o = map[hora] || (map[hora] = { resultado: 0, conversas: 0, sessoes: 0 });
    o.resultado += r; o.conversas += c; o.sessoes += s;
  };

  for (const acc of accounts || []) {
    const { ad_account_id, access_token: token } = acc;
    if (!token) continue;
    const accountId = String(ad_account_id).startsWith('act_') ? String(ad_account_id) : `act_${ad_account_id}`;
    const accountTz = apiInfo[accountId]?.timezone_name || 'America/Sao_Paulo';
    const needsRebucket = accountTz !== 'America/Sao_Paulo';
    const hrSince = needsRebucket
      ? DateTime.fromISO(date, { zone: 'America/Sao_Paulo' }).minus({ days: 1 }).toISODate()
      : date;
    const hrUntil = date;

    try {
      let nextUrl = `${BASE}/${accountId}/insights`;
      let params = {
        access_token: token,
        level: 'campaign',
        fields: 'campaign_name,objective,optimization_goal,actions,clicks,date_start',
        time_range: JSON.stringify({ since: hrSince, until: hrUntil }),
        time_increment: 1,
        breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
        limit: 500,
      };
      while (nextUrl) {
        const res = await axios.get(nextUrl, { params, timeout: 30000 });
        params = undefined;
        for (const row of res.data?.data || []) {
          const hStr = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
          const conv = converterHoraParaBR(row.date_start || date, hStr, accountTz);
          if (!conv || conv.dataBR !== date) continue;
          const { horaBR } = conv;
          const tipo = extractTipo(row.campaign_name || '');
          // resultado é tipo-dependente (bot=view_content · direto=objetivo) — mesma
          // regra canônica do sync diário (getResultadoMeta)
          const resultado = getResultadoMeta(
            { actions: row.actions, objective: row.objective, optimization_goal: row.optimization_goal, clicks: row.clicks },
            tipo,
          );
          const conversas = findAction(row.actions, ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply']);
          const sessoes = findAction(row.actions, ['view_content', 'omni_view_content', 'offsite_conversion.fb_pixel_view_content']);
          if (!resultado && !conversas && !sessoes) continue;
          addTo(globalMap, horaBR, resultado, conversas, sessoes);
          const prefix = extractDomainPrefix(row.campaign_name || '');
          if (prefix) {
            if (!prefixMap[prefix]) prefixMap[prefix] = {};
            addTo(prefixMap[prefix], horaBR, resultado, conversas, sessoes);
          }
        }
        nextUrl = res.data?.paging?.next || null;
      }
    } catch (e) {
      complete = false;
      console.warn(`[hourly Meta actions ${accountId}] falhou (métricas desta conta ausentes no ciclo):`, e.response?.data?.error?.message || e.message);
    }
  }

  const totRes = Object.values(globalMap).reduce((a, o) => a + o.resultado, 0);
  console.log(`[hourly Meta actions] ${date}: ${Object.keys(globalMap).length} horas, Σresultado=${totRes}, complete=${complete}, prefixos:[${Object.keys(prefixMap).join(', ')}]`);
  return { global: globalMap, byPrefix: prefixMap, complete };
}

// Fetch GAM + Meta hourly data for one date and upsert into dados_hora.
async function fetchAndSaveHourly(date) {
  const { data: dominios } = await supabase
    .from('dominios')
    .select('id,prefixo_campanha,prefixo_ad_unit,codigo_pedido_gam')
    .eq('ativo', true);

  const [gamByDom, metaHoraMap, metaActions] = await Promise.all([
    fetchGAMHourlyByDomain({ since: date, until: date, dominios }).catch(e => { console.warn('[hourly GAM]', e.message); return {}; }),
    fetchMetaHourlySpend(date).catch(e => { console.warn('[hourly Meta]', e.message); return { _global_: {}, _complete: false }; }),
    fetchMetaHourlyActions(date).catch(e => { console.warn('[hourly Meta actions]', e.message); return { global: {}, byPrefix: {}, complete: false }; }),
  ]);

  const gamRows = gamByDom[0] || [];
  const globalHoraMap = metaHoraMap._global_ || {};
  const metricsGlobal = metaActions.global || {};
  const metricsByPrefix = metaActions.byPrefix || {};

  const gamMap = {};
  for (const h of gamRows) gamMap[h.hora] = h;

  // Quando a busca horária da Meta veio incompleta, NÃO zerar o investimento já
  // gravado nas horas ausentes. Dois casos cobertos:
  //   • mapa VAZIO — falha total de API/Supabase (fallback { _global_: {} }) ou
  //     meta_accounts vazio.
  //   • mapa PARCIAL (_complete=false) — paginação de alguma conta falhou no meio
  //     (throttle): o Meta devolve as datas antigas primeiro, então as horas mais
  //     RECENTES de hoje somem do mapa. Sem este guard, elas eram reescritas com
  //     investimento_brl = 0 (o skip de linha-viva pela receita GAM mantinha a
  //     linha), zerando o investimento das últimas horas até um sync completo.
  const metaComplete   = metaHoraMap._complete !== false;
  const metaHourlyEmpty = Object.keys(globalHoraMap).length === 0;
  const preserveMissing = metaHourlyEmpty || !metaComplete;
  // Métricas Meta (actions) têm ciclo de completude próprio: se a query de actions
  // falhou/veio parcial, NÃO zerar resultado/conversas/sessões — preservar o já
  // gravado (mesma proteção do investimento, estendida às novas colunas).
  const metricsEmpty    = Object.keys(metricsGlobal).length === 0;
  const preserveMetrics = metricsEmpty || metaActions.complete === false;

  const existingInvGlobal = {};
  const existingMetGlobal = {};   // hora → { resultado, conversas, sessoes }
  const existingMetDom = {};      // `${domId}|${hora}` → { resultado, conversas, sessoes }
  if (preserveMissing || preserveMetrics) {
    const { data: prev } = await supabase.from('dados_hora')
      .select('hora,investimento_brl,resultado,conversas,sessoes')
      .eq('data', date).eq('dominio_id', 0);
    for (const p of prev || []) {
      existingInvGlobal[p.hora] = +(p.investimento_brl || 0);
      existingMetGlobal[p.hora] = { resultado: p.resultado || 0, conversas: p.conversas || 0, sessoes: p.sessoes || 0 };
    }
    const { data: prevDom } = await supabase.from('dados_hora')
      .select('dominio_id,hora,resultado,conversas,sessoes')
      .eq('data', date).neq('dominio_id', 0);
    for (const p of prevDom || []) existingMetDom[`${p.dominio_id}|${p.hora}`] = { resultado: p.resultado || 0, conversas: p.conversas || 0, sessoes: p.sessoes || 0 };
    if (preserveMissing) console.warn(`[hourly] ${date}: Meta horária ${metaHourlyEmpty ? 'vazia' : 'parcial'} — preservando investimento existente nas horas ausentes (sem zerar)`);
    if (preserveMetrics) console.warn(`[hourly] ${date}: Meta actions ${metricsEmpty ? 'vazia' : 'parcial'} — preservando resultado/conversas/sessões existentes nas horas ausentes`);
  }

  const rows = [];
  for (let hora = 0; hora < 24; hora++) {
    const gam = gamMap[hora];
    // Hora presente no mapa novo → usa o valor da Meta. Ausente → preserva o
    // existente (se incompleto) ou 0 (se completo, é ausência legítima de gasto).
    const inv = globalHoraMap[hora] != null
      ? +globalHoraMap[hora].toFixed(4)
      : preserveMissing
        ? +(existingInvGlobal[hora] || 0).toFixed(4)
        : 0;
    // Métricas Meta (actions): presente → usa; ausente → preserva (se parcial) ou 0.
    const mg = metricsGlobal[hora];
    const resultado = mg ? mg.resultado : (preserveMetrics ? (existingMetGlobal[hora]?.resultado || 0) : 0);
    const conversas = mg ? mg.conversas : (preserveMetrics ? (existingMetGlobal[hora]?.conversas || 0) : 0);
    const sessoes   = mg ? mg.sessoes   : (preserveMetrics ? (existingMetGlobal[hora]?.sessoes   || 0) : 0);
    const rec = gam?.receita || 0;
    const imp = gam?.impressoes || 0;
    if (rec === 0 && inv === 0 && imp === 0 && resultado === 0 && conversas === 0 && sessoes === 0) continue;
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
      resultado, conversas, sessoes,
      roi,
      atualizado_em:    new Date().toISOString(),
    });
  }

  // Linhas por domínio: só investimento Meta filtrado pelo prefixo da campanha
  // receita/ecpm/impressoes ficam em report_hora (consultadas pela intraday route)
  const domByPrefix = {};
  for (const d of dominios || []) {
    if (d.prefixo_campanha) domByPrefix[d.prefixo_campanha.toUpperCase()] = d.id;
  }
  // União dos prefixos/horas de spend (metaHoraMap) e de actions (metricsByPrefix).
  const domPrefixes = new Set();
  for (const p of Object.keys(metaHoraMap)) {
    if (p === '_global_' || p === '_complete') continue;
    if (domByPrefix[p.toUpperCase()]) domPrefixes.add(p);
  }
  for (const p of Object.keys(metricsByPrefix)) {
    if (domByPrefix[p.toUpperCase()]) domPrefixes.add(p);
  }
  for (const prefix of domPrefixes) {
    const domId = domByPrefix[prefix.toUpperCase()];
    const spendHoras = metaHoraMap[prefix] || {};
    const metricHoras = metricsByPrefix[prefix] || {};
    const horas = new Set([...Object.keys(spendHoras), ...Object.keys(metricHoras)].map(Number));
    for (const hora of horas) {
      const inv = +((spendHoras[hora] || 0)).toFixed(4);
      // actions ausentes desta hora → preserva o existente (se parcial) senão 0.
      const m = metricHoras[hora]
        || (preserveMetrics ? existingMetDom[`${domId}|${hora}`] : null)
        || { resultado: 0, conversas: 0, sessoes: 0 };
      if (inv <= 0 && !m.resultado && !m.conversas && !m.sessoes) continue;
      rows.push({
        data: date, hora, dominio_id: domId,
        receita_bruta: 0, impressoes: 0, ecpm: 0,
        investimento_brl: inv,
        resultado: m.resultado, conversas: m.conversas, sessoes: m.sessoes,
        roi: 0,
        atualizado_em: new Date().toISOString(),
      });
    }
  }

  // report_hora: receita/ecpm/impressões horárias por domínio + global (dominio_id=0).
  // Fonte do intraday filtrado por domínio. Escrito aqui (não só no cache do syncAll)
  // para cobrir as duas datas (since+until) e alinhar com a data de São Paulo lida
  // pela rota — o cache antigo gravava só a data UTC `until`, que diverge à noite BR.
  const nowIso = new Date().toISOString();
  const reportHoraRows = [];
  for (const [domIdStr, horas] of Object.entries(gamByDom)) {
    const domId = Number(domIdStr);
    for (const h of horas || []) {
      reportHoraRows.push({
        data: date, hora: h.hora,
        impressoes: h.impressoes || 0, nao_preenchidas: h.nao_preenchidas || 0,
        receita: h.receita || 0, ecpm: h.ecpm || 0, ctr: h.ctr || 0,
        cliques: h.cliques || 0, cpc: h.cpc || 0,
        prefixo_ad_unit: '', dominio_id: domId, updated_at: nowIso,
      });
    }
  }
  if (reportHoraRows.length > 0) {
    const { error: rhErr } = await supabase.from('report_hora')
      .upsert(reportHoraRows, { onConflict: 'data,hora,dominio_id' });
    if (rhErr) console.warn(`[hourly] upsert report_hora ${date}:`, rhErr.message);
    else console.log(`[hourly] report_hora: ${reportHoraRows.length} linhas (${Object.keys(gamByDom).length} séries) → ${date}`);
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

// Soma várias entradas do gamByDay (ex.: linhas por ad id + linha legada por nome)
// em uma só: revenue/impressions/cliques somados, ctr/ecpm ponderados por impressão,
// cpc ponderado por clique.
function mergeGamEntries(entries) {
  if (entries.length === 0) return {};
  if (entries.length === 1) return entries[0];
  const out = { revenue: 0, impressions: 0, cliques_gam: 0, ecpm: 0, ctr_gam: 0, cpc_gam: 0 };
  let ecpmSum = 0, ctrSum = 0, cpcSum = 0, impW = 0, cliW = 0;
  for (const e of entries) {
    out.revenue += e.revenue || 0;
    out.impressions += e.impressions || 0;
    out.cliques_gam += e.cliques_gam || 0;
    if ((e.impressions || 0) > 0) {
      ecpmSum += (e.ecpm || 0) * e.impressions;
      ctrSum += (e.ctr_gam || 0) * e.impressions;
      impW += e.impressions;
    }
    if ((e.cliques_gam || 0) > 0) {
      cpcSum += (e.cpc_gam || 0) * e.cliques_gam;
      cliW += e.cliques_gam;
    }
  }
  out.ecpm = impW > 0 ? ecpmSum / impW : 0;
  out.ctr_gam = impW > 0 ? ctrSum / impW : 0;
  out.cpc_gam = cliW > 0 ? cpcSum / cliW : 0;
  return out;
}

// ── Dimensão meta_entidades: hierarquia por id (ad → conjunto → campanha → página) ──
// Chave de cruzamento é SEMPRE id; nome é só rótulo de exibição. page_id é resolvido
// incrementalmente (apenas ads ainda sem page_id na dimensão) via batch `?ids=` na
// Graph API: adset.promoted_object.page_id (bot) || creative.object_story_spec.page_id
// (direto). Devolve o mapa ad_id → page_id para o receita_ads reaproveitar.
async function upsertMetaEntidades(adIdInfo) {
  const adIds = Object.keys(adIdInfo);
  if (!adIds.length) return {};

  // page_ids já conhecidos — nunca sobrescrever um page_id preenchido com null
  const pageByAd = {};
  for (let i = 0; i < adIds.length; i += 200) {
    const { data } = await supabase.from('meta_entidades')
      .select('ad_id,page_id').in('ad_id', adIds.slice(i, i + 200));
    for (const r of data || []) if (r.page_id) pageByAd[r.ad_id] = r.page_id;
  }

  const { data: accs } = await supabase.from('meta_accounts')
    .select('ad_account_id,access_token').eq('ativo', true);
  const tokenByAccount = {};
  for (const a of accs || []) {
    const k = String(a.ad_account_id).startsWith('act_') ? String(a.ad_account_id) : `act_${a.ad_account_id}`;
    if (a.access_token) tokenByAccount[k] = a.access_token;
  }

  const missingByAccount = {};
  for (const id of adIds) {
    if (pageByAd[id]) continue;
    const acc = adIdInfo[id].accountId;
    if (!acc || !tokenByAccount[acc]) continue;
    (missingByAccount[acc] ||= []).push(id);
  }
  for (const [acc, ids] of Object.entries(missingByAccount)) {
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      try {
        const r = await axios.get(`${BASE}/`, {
          params: {
            ids: batch.join(','),
            fields: 'adset{promoted_object{page_id}},creative{object_story_spec{page_id}}',
            access_token: tokenByAccount[acc],
          },
          timeout: 30000,
        });
        for (const [id, ad] of Object.entries(r.data || {})) {
          const pid = ad?.adset?.promoted_object?.page_id || ad?.creative?.object_story_spec?.page_id;
          if (pid) pageByAd[id] = String(pid);
        }
      } catch (e) {
        // Falha de um batch não bloqueia: page_id fica null e é retentado no próximo sync
        console.warn(`[entidades] page_id batch ${acc}:`, e.response?.data?.error?.message || e.message);
      }
    }
  }

  const nowIso = new Date().toISOString();
  const rows = adIds.map(id => {
    const i = adIdInfo[id];
    return {
      ad_id: id,
      adset_id: i.adsetId,
      campaign_id: i.campaignId,
      page_id: pageByAd[id] || null,
      ad_name: i.adName,
      adset_name: i.adsetName,
      campaign_name: i.campaignName,
      ad_utm: i.utm,
      dominio_id: i.domainId,
      account_id: i.accountId,
      tipo: i.tipo,
      pais_sigla: i.paisSigla,
      nicho: i.nicho,
      updated_at: nowIso,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('meta_entidades')
      .upsert(rows.slice(i, i + 500), { onConflict: 'ad_id' });
    if (error) { console.warn('[entidades] upsert:', error.message); break; }
  }
  const comPagina = rows.filter(r => r.page_id).length;
  console.log(`[entidades] ${rows.length} ads na dimensão (${comPagina} com page_id)`);
  return pageByAd;
}

// Main sync function
// ─────────────────────────────────────────────
function yesterday() {
  return diasAtrasBR(1);
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
    const [metaRes, gamReport, gamFunnels] = await Promise.all([
      // failedAccounts: null = não sabemos o que falhou → a poda não roda (fail-safe)
      fetchMetaAdsForSync(dr).catch(e => { console.error('[sync] Meta:', e.message); return { ads: [], failedBMs: [`fetch geral: ${e.message}`], failedAccounts: null }; }),
      fetchGAMReport(dr).catch(e => { console.error('[sync] GAM report:', e.message); return null; }),
      fetchGAMFunnelsByUTM(null, dr).catch(e => { console.error('[sync] GAM UTM:', e.message); return { campaigns: [] }; }),
    ]);

    const metaAds = metaRes.ads;
    const metaFailedBMs = metaRes.failedBMs;
    const metaFailedAccounts = metaRes.failedAccounts === undefined ? null : metaRes.failedAccounts;

    // GAM UTM lookup by day: byDay['yyyy-mm-dd']['utm'] → { revenue, impressions, ecpm }
    const gamByDay = gamFunnels?.byDay || {};

    // GAM fora do ar ≠ dia sem receita. fetchGAMFunnelsByUTM engole o próprio
    // erro e devolve {campaigns: []} SEM byDay; fetchGAMReport vira null no
    // catch acima. A janela (ontem+hoje) sempre tem receita, então byDay vazio
    // só acontece em falha — nesses ciclos NÃO se pode gravar faturamento 0 por
    // cima do que já foi casado (jul/2026: um ciclo assim zerou a receita de
    // ontem+hoje no dash, com status "success"). Ver merge antes do upsert.
    const gamFunnelsOk = Object.keys(gamByDay).length > 0;
    const gamReportOk = Object.keys(gamReport?.adUnitsByDay || {}).length > 0;

    // ── Process Meta ads ──────────────────────────
    const pendingPrefixes = new Map(); // prefix → example campaign name
    const adsForGrouping = [];
    const adIdToUtm = {}; // ad_id → adUTM (utm_campaign agora carrega o ad id da Meta)
    const adIdInfo = {};  // ad_id → { adsetId, utm, domainId } (p/ receita_ads → ROI por conjunto)

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
      const sessoes_meta_ad   = findAction(ad.actions, ['view_content', 'omni_view_content', 'offsite_conversion.fb_pixel_view_content']);
      const conversas_meta_ad = findAction(ad.actions, ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply']);

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
      if (ad.ad_id) {
        adIdToUtm[String(ad.ad_id)] = adUTM;
        adIdInfo[String(ad.ad_id)] = {
          adsetId: ad.adset_id ? String(ad.adset_id) : null,
          campaignId: ad.campaign_id ? String(ad.campaign_id) : null,
          adName: ad.ad_name || null,
          adsetName: ad.adset_name || null,
          campaignName: ad.campaign_name || null,
          accountId: ad._accountId || null,
          tipo,
          paisSigla: paisSigla || null,
          nicho: nicho || null,
          utm: adUTM,
          domainId: domain.id,
        };
      }
      adsForGrouping.push({
        adUTM,
        adId: ad.ad_id ? String(ad.ad_id) : null,
        campaignId: ad.campaign_id ? String(ad.campaign_id) : null,
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
        sessoes_meta: sessoes_meta_ad,
        conversas_meta: conversas_meta_ad,
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
    // Fallback GAM por NOME não distingue campanhas homônimas (mesmo utm em
    // E1/E2/…): atribui a receita por nome só ao grupo de MAIOR gasto do dia
    // naquele utm — os demais ficam com o match exato por id. Sem isso, a mesma
    // receita seria somada em cada campanha irmã (dupla contagem).
    const donoDoNome = {}; // `${date}|${domainId}|${utm}` → chave do grupo vencedor
    for (const g of grouped) {
      const k = `${g.date}|${g.domainId}|${g.adUTM.toLowerCase()}`;
      const atual = donoDoNome[k];
      if (!atual || (g.spend || 0) > atual.spend) donoDoNome[k] = { id: `${g.accountId}|${g.campaignId}`, spend: g.spend || 0 };
    }

    let adsRows = [];
    for (const g of grouped) {
      const dayGam = gamByDay[g.date] || {};
      const utmKey = g.adUTM.toLowerCase();
      const souDonoDoNome = donoDoNome[`${g.date}|${g.domainId}|${utmKey}`]?.id === `${g.accountId}|${g.campaignId}`;
      // DIRETO campaigns: Meta ad name includes "-direto-" but GAM utm_campaign omits it
      // e.g. "relamad-australia-direto-fb" → try "relamad-australia-fb" as fallback
      const utmKeyNoDireto = utmKey.replace(/-direto-?/, '-').replace(/-$/, '');
      // utm_campaign no site agora carrega o ad id da Meta → match exato por id,
      // somando todos os ads do grupo. O nome parseado continua como fallback
      // ADITIVO (histórico + transição): tráfego antigo chega pelo nome e o novo
      // pelo id no mesmo dia — as linhas GAM são distintas, somar não duplica.
      const gamKeys = (g.adIds || []).filter(id => dayGam[id]);
      const matchPorId = gamKeys.length > 0;
      let matchPorNome = false;
      if (souDonoDoNome && dayGam[utmKey]) { gamKeys.push(utmKey); matchPorNome = true; }
      else if (souDonoDoNome && dayGam[utmKeyNoDireto]) { gamKeys.push(utmKeyNoDireto); matchPorNome = true; }
      // Auditável: como a receita desta linha foi casada com o GAM
      const gamMatch = matchPorId && matchPorNome ? 'id+nome' : matchPorId ? 'id' : matchPorNome ? 'nome' : null;
      const gam = mergeGamEntries(gamKeys.map(k => dayGam[k]));
      const faturamentoBruto = gam.revenue || 0;
      // Taxa 10% aplicada AQUI. Não aplicar de novo no frontend nem nas rotas de API.
      if (g.tipo === 'direto') {
        const availKeys = Object.keys(dayGam);
        const matched = gamKeys.length > 0 ? gamKeys.join('+') : 'NONE';
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

      // Orçamento vem da Meta na moeda da conta — converter para BRL com imposto,
      // como o valor_gasto, para previsão/pacing compararem na mesma unidade
      const orcamentoBRL = (g.orcamentoTotal || 0) * (moeda === 'USD' ? taxaAplicada : 1) * fatorImposto;

      // Previsão: only for today when we have partial data and a known budget
      const isThisToday = g.date === today();
      let prevImp = 0, prevFat = 0, prevFatReal = 0, prevLucro = 0, prevRoas = 0;
      if (isThisToday && g.clicks > 0 && g.cpc > 0 && g.orcamentoTotal > 0 && impressoesGam > 0) {
        // orçamento/cpc na moeda da conta — razão adimensional, não precisa converter
        const cliquesPrevistos = g.orcamentoTotal / g.cpc;
        const proporcao = impressoesGam / g.clicks;
        prevImp = Math.round(cliquesPrevistos * proporcao);
        prevFat = prevImp * (ecpm / 1000);
        prevFatReal = prevFat * 0.9;
        prevLucro = prevFatReal - orcamentoBRL;
        prevRoas = orcamentoBRL > 0 ? prevFatReal / orcamentoBRL : 0;
      }

      if (g.orcamentoTotal > 0) console.log(`[budget] date=${g.date} utm="${g.adUTM}" tipo=${g.tipo} orcamento=${moeda} ${(g.orcamentoTotal || 0).toFixed(2)} -> R$${orcamentoBRL.toFixed(2)}`);
      const cpcComImposto = g.clicks > 0 ? valorGastoComImposto / g.clicks : 0;
      const gPaisSigla = g.paisSigla || '';
      const country = gPaisSigla ? resolveCountry(gPaisSigla) : null;
      const gPaisNome  = country?.nome  || '';
      const gPaisEmoji = country?.emoji || '';
      adsRows.push({
        data: g.date,
        dominio_id: g.domainId,
        ad_utm: g.adUTM,
        campaign_id: g.campaignId || null,
        gam_match: gamMatch,
        campanha_meta: g.campaignName,
        tipo: g.tipo,
        account_id: g.accountId || null,
        pais_sigla: gPaisSigla,
        pais_nome: gPaisNome,
        pais_emoji: gPaisEmoji,
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
        orcamento_total: +orcamentoBRL.toFixed(2),
        previsao_impressoes: prevImp,
        previsao_faturamento: +prevFat.toFixed(2),
        previsao_faturamento_real: +prevFatReal.toFixed(2),
        previsao_lucro: +prevLucro.toFixed(2),
        previsao_roas: +prevRoas.toFixed(4),
        cpc_gam: +cpcGam.toFixed(4),
        ctr_gam: +ctrGam.toFixed(2),
        cliques_gam: cliquesGam,
        sessoes_meta: g.sessoes_meta || 0,
        conversas_meta: g.conversas_meta || 0,
        updated_at: new Date().toISOString(),
      });
    }

    // ── GAM caiu neste ciclo? Preserva a receita já gravada ──────────────────
    // O gasto Meta continua fresco; só os campos derivados do GAM voltam do
    // banco. lucro/roas são recalculados com o gasto NOVO. Some no próximo
    // ciclo bom, tudo é reescrito com dado real.
    if ((!gamFunnelsOk || !gamReportOk) && adsRows.length > 0) {
      const datas = [...new Set(adsRows.map(r => r.data))];
      const { data: prevRows, error: prevErr } = await supabase
        .from('ads_consolidados')
        .select('data,dominio_id,ad_utm,account_id,pais_sigla,campaign_id,faturamento_bruto,faturamento_real,impressoes_gam,ecpm,rps,gam_match,cpc_gam,ctr_gam,cliques_gam,viewability')
        .in('data', datas);
      if (prevErr) {
        console.warn('[sync] GAM indisponível e falhou a leitura do estado anterior:', prevErr.message);
      } else {
        const kOf = r => `${r.data}|${r.dominio_id}|${r.ad_utm}|${r.account_id || ''}|${r.pais_sigla || ''}|${r.campaign_id || ''}`;
        const prevMap = new Map((prevRows || []).map(r => [kOf(r), r]));
        let preservadas = 0;
        for (const r of adsRows) {
          const p = prevMap.get(kOf(r));
          if (!p) continue;
          if (!gamFunnelsOk) {
            r.faturamento_bruto = Number(p.faturamento_bruto || 0);
            r.faturamento_real = Number(p.faturamento_real || 0);
            r.impressoes_gam = Number(p.impressoes_gam || 0);
            r.ecpm = Number(p.ecpm || 0);
            r.rps = Number(p.rps || 0);
            r.gam_match = p.gam_match || null;
            r.cpc_gam = Number(p.cpc_gam || 0);
            r.ctr_gam = Number(p.ctr_gam || 0);
            r.cliques_gam = Number(p.cliques_gam || 0);
            r.lucro = +(r.faturamento_real - r.valor_gasto).toFixed(2);
            r.roas = r.valor_gasto > 0 ? +(r.faturamento_real / r.valor_gasto).toFixed(4) : 0;
            if (r.faturamento_real > 0) preservadas++;
          }
          if (!gamReportOk) r.viewability = Number(p.viewability || 0);
        }
        console.warn(`[sync] GAM indisponível (funnels=${gamFunnelsOk ? 'ok' : 'FALHOU'}, report=${gamReportOk ? 'ok' : 'FALHOU'}) — receita preservada do ciclo anterior em ${preservadas}/${adsRows.length} linhas`);
      }
    }

    if (adsRows.length > 0) {
      // Deduplicate: remove zero-spend shadow rows for UTMs where another account
      // has actual spend on the same date+domain. Prevents double-counting GAM revenue.
      // Exceção: linha sem gasto mas com receita casada por ID é legítima (campanha
      // pausada que ainda fatura) — nunca descartar.
      const utmsWithSpend = new Set(
        adsRows.filter(r => (r.valor_gasto || 0) > 0)
          .map(r => `${r.data}|${r.dominio_id}|${r.ad_utm}`)
      );
      const beforeDedup = adsRows.length;
      adsRows = adsRows.filter(r =>
        (r.valor_gasto || 0) > 0 || (r.gam_match || '').includes('id') || !utmsWithSpend.has(`${r.data}|${r.dominio_id}|${r.ad_utm}`)
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
        .upsert(adsRows, { onConflict: 'data,dominio_id,ad_utm,account_id,pais_sigla,campaign_id' });
      if (uErr && uErr.message.toLowerCase().includes('could not find')) {
        // New columns not yet migrated — retry without them
        const fallback = adsRows.map(({ cpc_gam, ctr_gam, cliques_gam, sessoes_meta, conversas_meta, account_id, valor_gasto_original, imposto_aplicado, moeda_original, taxa_usd_aplicada, pais_sigla, pais_nome, pais_emoji, nicho, campaign_id, gam_match, ...rest }) => rest);
        ({ error: uErr } = await supabase
          .from('ads_consolidados')
          .upsert(fallback, { onConflict: 'data,dominio_id,ad_utm,account_id,pais_sigla,campaign_id' }));
        if (!uErr) console.warn('[sync] upserted without new columns — run ALTER TABLE migration');
      }
      if (uErr) console.error('[sync] upsert ads_consolidados:', uErr.message);
      rowsProcessed += adsRows.length;

      // ── Poda de linhas órfãs ───────────────────────────────────────────────
      // ad_utm e campanha_meta vêm do NOME na Meta e fazem parte da chave de
      // upsert. Renomear um anúncio no meio do dia cria uma linha NOVA e deixa a
      // do nome antigo intacta, com o gasto dela — o dia passa a somar duas vezes
      // (jul/2026: C 01 em 19/07 marcava 101,61 vs 63,52 reais na Meta).
      // Depois de gravar, apaga o que existe para (data, account_id) e NÃO veio
      // neste sync. Só roda em (data, conta) que acabamos de escrever, então dia
      // sem gasto nunca é tocado.
      if (!uErr) {
        const falhou = metaFailedAccounts === null ? null : new Set(metaFailedAccounts);
        const chaveDe = r => `${r.dominio_id}|${r.ad_utm}|${r.pais_sigla || ''}|${r.campaign_id || ''}`;
        const escritas = {};   // `${data}|${account_id}` → Set(chaves)
        for (const r of adsRows) {
          if (!r.account_id) continue;
          (escritas[`${r.data}|${r.account_id}`] ||= new Set()).add(chaveDe(r));
        }
        if (falhou === null) {
          console.warn('[poda] pulada — não foi possível saber quais contas falharam');
        } else {
          let podadas = 0;
          for (const [k, chaves] of Object.entries(escritas)) {
            const sep = k.indexOf('|');
            const data = k.slice(0, sep), accountId = k.slice(sep + 1);
            // Conta que falhou tem dado incompleto neste ciclo — podar apagaria o que é bom.
            if (falhou.has(accountId)) { console.warn(`[poda] ${data} ${accountId}: pulada (conta falhou na Meta)`); continue; }
            const { data: existentes, error: selErr } = await supabase
              .from('ads_consolidados')
              .select('id,dominio_id,ad_utm,pais_sigla,campaign_id,manually_fixed,valor_gasto')
              .eq('data', data).eq('account_id', accountId);
            if (selErr) { console.warn(`[poda] ${data} ${accountId}: select falhou — ${selErr.message}`); continue; }
            const orfas = (existentes || []).filter(r => !r.manually_fixed && !chaves.has(chaveDe(r)));
            if (!orfas.length) continue;
            const perdido = orfas.reduce((s, r) => s + Number(r.valor_gasto || 0), 0);
            const { error: delErr } = await supabase
              .from('ads_consolidados').delete().in('id', orfas.map(r => r.id));
            if (delErr) { console.warn(`[poda] ${data} ${accountId}: delete falhou — ${delErr.message}`); continue; }
            podadas += orfas.length;
            console.log(`[poda] ${data} ${accountId}: ${orfas.length} órfã(s), R$ ${perdido.toFixed(2)} de gasto fantasma removido — ${orfas.slice(0, 6).map(r => r.ad_utm).join(', ')}`);
          }
          if (podadas) console.log(`[poda] total: ${podadas} linha(s) removida(s)`);
        }
      }

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

    // ── Dimensão meta_entidades (hierarquia por id, com page_id) ─────────────
    let pageByAd = {};
    try {
      pageByAd = await upsertMetaEntidades(adIdInfo);
    } catch (e) {
      console.warn('[sync] meta_entidades:', e.message);
    }

    // ── Receita GAM por ad id → receita_ads (base do ROI por conjunto no drilldown) ──
    // Receita fica BRUTA aqui; a taxa de 10% é aplicada na rota que consome (como blocos_anuncio).
    try {
      const nowIso = new Date().toISOString();
      const receitaAdsRows = [];
      for (const [dia, utmMap] of Object.entries(gamByDay)) {
        for (const [key, v] of Object.entries(utmMap)) {
          const info = adIdInfo[key];
          if (!info) continue; // chave legada por nome, ou ad id fora da janela do sync
          receitaAdsRows.push({
            data: dia,
            ad_id: key,
            adset_id: info.adsetId,
            campaign_id: info.campaignId,
            page_id: pageByAd[key] || null,
            ad_utm: info.utm,
            dominio_id: info.domainId,
            receita_bruta: +(v.revenue || 0).toFixed(4),
            impressoes: v.impressions || 0,
            cliques: v.cliques_gam || 0,
            updated_at: nowIso,
          });
        }
      }
      if (receitaAdsRows.length > 0) {
        const { error: raErr } = await supabase.from('receita_ads')
          .upsert(receitaAdsRows, { onConflict: 'data,ad_id' });
        if (raErr) console.warn('[sync] upsert receita_ads:', raErr.message);
        else console.log(`[sync] receita_ads: ${receitaAdsRows.length} linhas (receita GAM por ad id)`);
      }
    } catch (e) {
      console.warn('[sync] receita_ads:', e.message);
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
      // report_hora (horário por domínio + global) é populado em fetchAndSaveHourly,
      // que roda para since+until e alinha com a data de São Paulo lida pela rota.
      const [utmCampaigns, utmSources] = await Promise.all([
        fetchGAMUtmCampaigns({ since: until, until }).catch(e => { console.warn('[sync] GAM utm cache:', e.message); return []; }),
        fetchGAMUtmSources({ since: until, until }).catch(e => { console.warn('[sync] GAM src cache:', e.message); return []; }),
      ]);

      const now = new Date().toISOString();
      const pfx = dominios?.[0]?.prefixo_ad_unit || '';

      if (utmCampaigns.length > 0) {
        // utm_campaign agora pode ser um ad id da Meta — traduz para o utm do
        // anúncio e re-agrega (linhas por id + linha legada por nome colapsam
        // na mesma chave do upsert, então precisam ser somadas antes)
        const porUtm = {};
        for (const u of utmCampaigns) {
          const nome = adIdToUtm[u.utm_campaign] || u.utm_campaign;
          if (!porUtm[nome]) {
            porUtm[nome] = { utm_campaign: nome, impressoes: 0, receita: 0, cliques: 0, ecpmW: 0, ctrW: 0, cpcW: 0 };
          }
          const t = porUtm[nome];
          t.impressoes += u.impressoes || 0;
          t.receita += u.receita || 0;
          t.cliques += u.cliques || 0;
          t.ecpmW += (u.ecpm || 0) * (u.impressoes || 0);
          t.ctrW += (u.ctr || 0) * (u.impressoes || 0);
          t.cpcW += (u.cpc || 0) * (u.cliques || 0);
        }
        const utmRows = Object.values(porUtm);
        const { error: utmErr } = await supabase.from('report_utm_campaign')
          .upsert(
            utmRows.map(u => ({
              data: until,
              utm_campaign: u.utm_campaign,
              dominio_id: 0,
              impressoes: u.impressoes,
              receita: +u.receita.toFixed(2),
              ecpm: u.impressoes > 0 ? +(u.ecpmW / u.impressoes).toFixed(4) : 0,
              ctr: u.impressoes > 0 ? +(u.ctrW / u.impressoes).toFixed(4) : 0,
              cliques: u.cliques,
              cpc: u.cliques > 0 ? +(u.cpcW / u.cliques).toFixed(4) : 0,
              prefixo_ad_unit: pfx,
              updated_at: now,
            })),
            { onConflict: 'data,utm_campaign,dominio_id' }
          );
        if (utmErr) console.warn('[sync] upsert report_utm_campaign:', utmErr.message);
        else console.log(`[sync] cache GAM: ${utmRows.length} UTMs salvas (${utmCampaigns.length} linhas brutas)`);
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

    // Sync de páginas removido do cron — o wizard de Criar Campanha dispara
    // /api/paginas/sync sob demanda; evita chamadas Meta extras a cada ciclo

    // ── Log success ───────────────────────────────
    const duration = Date.now() - startMs;
    const gamNotes = [];
    if (!gamFunnelsOk) gamNotes.push('FALHA GAM UTM: receita preservada do ciclo anterior');
    if (!gamReportOk) gamNotes.push('FALHA GAM report: blocos/viewability não atualizados');
    const syncStatus = (metaFailedBMs.length > 0 || gamNotes.length > 0) ? 'partial' : 'success';
    const failNote = (metaFailedBMs.length > 0 ? ` | FALHA Meta: ${metaFailedBMs.join('; ')}` : '')
      + (gamNotes.length > 0 ? ` | ${gamNotes.join('; ')}` : '');
    await supabase.from('sync_log').insert({
      source: 'syncAll',
      status: syncStatus,
      message: `${adsRows.length} ads upserted, ${pendingPrefixes.size} domínios pendentes${failNote}`.slice(0, 500),
      rows_processed: rowsProcessed,
      duration_ms: duration,
    });

    console.log(`[sync] ${syncStatus.toUpperCase()} — ${adsRows.length} ads (${since}→${until}), ${pendingPrefixes.size} pending, ${duration}ms${failNote}`);
    return { success: true, rowsProcessed, pendingDomains: [...pendingPrefixes.keys()], failedBMs: metaFailedBMs, durationMs: duration };

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

// ── Sync páginas (Facebook Pages) ────────────────────────────────────────────

async function syncPaginas() {
  console.log('[syncPaginas] iniciando...');
  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('ad_account_id,access_token,nome')
    .eq('ativo', true);

  if (!accounts?.length) { console.warn('[syncPaginas] nenhuma conta ativa'); return; }

  const hoje = hojeBR();

  // page_id → { id, name, picture_url, sourceAccountId }
  const allPagesMap = new Map();

  // page_id → Map<accountId, Set<adset_id>>
  const pageAccountAdsets = new Map();

  for (const acc of accounts) {
    if (!acc.access_token) continue;
    const accountId = String(acc.ad_account_id).startsWith('act_')
      ? String(acc.ad_account_id)
      : `act_${acc.ad_account_id}`;

    // ── 1. Buscar páginas (cache primeiro, depois Meta API) ───────────────────
    let pages = [];
    {
      const { data: cacheRow } = await supabase
        .from('meta_resources_cache')
        .select('data')
        .eq('account_id', accountId)
        .eq('resource_type', 'pages')
        .eq('query_hash', '')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      pages = cacheRow?.data?.pages || [];
      if (pages.length) console.log(`[syncPaginas] ${accountId}: ${pages.length} páginas do cache`);
    }

    if (!pages.length) {
      const normalize = p => ({ id: p.id, name: p.name, picture_url: p.picture?.data?.url || null });
      const [resMe, resPromote] = await Promise.allSettled([
        axios.get(`${BASE}/me/accounts`, {
          params: { access_token: acc.access_token, fields: 'id,name,picture{url}', limit: 100 },
          timeout: 20000,
        }),
        axios.get(`${BASE}/${accountId}/promote_pages`, {
          params: { access_token: acc.access_token, fields: 'id,name,picture{url}', limit: 100 },
          timeout: 20000,
        }),
      ]);
      const fromMe      = resMe.status === 'fulfilled' ? (resMe.value.data?.data || []).map(normalize) : [];
      const fromPromote = resPromote.status === 'fulfilled' ? (resPromote.value.data?.data || []).map(normalize) : [];
      if (resMe.status === 'rejected')
        console.warn(`[syncPaginas] ${accountId} /me/accounts:`, resMe.reason?.response?.data?.error?.message || resMe.reason?.message);
      if (resPromote.status === 'rejected')
        console.warn(`[syncPaginas] ${accountId} promote_pages:`, resPromote.reason?.response?.data?.error?.message || resPromote.reason?.message);
      const seen = new Map();
      for (const p of [...fromMe, ...fromPromote]) if (!seen.has(p.id)) seen.set(p.id, p);
      pages = [...seen.values()];
      console.log(`[syncPaginas] ${accountId}: /me/accounts→${fromMe.length} promote_pages→${fromPromote.length}`);
    }

    for (const p of pages) {
      if (!allPagesMap.has(p.id)) {
        allPagesMap.set(p.id, {
          id: p.id,
          name: p.name,
          picture_url: p.picture_url ?? p.picture?.data?.url ?? null,
          sourceAccountId: acc.ad_account_id,
        });
      }
    }

    // ── 2. Buscar ads ATIVOS na Meta API e mapear page_ids ────────────────────
    // BOT/Messenger: adset.promoted_object.page_id
    // Direto:        creative.object_story_spec.page_id
    try {
      let nextUrl = `${BASE}/${accountId}/ads`;
      let reqParams = {
        effective_status: JSON.stringify(['ACTIVE']),
        fields: 'adset_id,adset{effective_status,promoted_object{page_id}},creative{object_story_spec{page_id}}',
        limit: 500,
        access_token: acc.access_token,
      };

      while (nextUrl) {
        const r = await axios.get(nextUrl, { params: reqParams, timeout: 30000 });
        const ads = r.data?.data || [];

        for (const ad of ads) {
          const adsetId = ad.adset_id;
          const pageId = ad.adset?.promoted_object?.page_id
                      || ad.creative?.object_story_spec?.page_id;

          if (pageId && adsetId) {
            if (!pageAccountAdsets.has(pageId)) pageAccountAdsets.set(pageId, new Map());
            const acctMap = pageAccountAdsets.get(pageId);
            if (!acctMap.has(accountId)) acctMap.set(accountId, new Set());
            acctMap.get(accountId).add(adsetId);
          }
        }

        nextUrl = r.data?.paging?.next || null;
        reqParams = {};
      }

      console.log(`[syncPaginas] ${accountId}: ads ativos processados`);
    } catch (e) {
      console.warn(`[syncPaginas] ${accountId} ads ACTIVE:`, e.response?.data?.error?.message || e.message);
    }
  }

  if (!allPagesMap.size) {
    console.warn('[syncPaginas] nenhuma página encontrada');
    return;
  }

  // ── 3. Upsert cada página com status e adsets_ativos corretos ──────────────
  let emUsoCount = 0;

  for (const [pageId, page] of allPagesMap) {
    const acctMap = pageAccountAdsets.get(pageId);
    let adsets_ativos = 0;
    let bestAccountId = page.sourceAccountId;

    if (acctMap && acctMap.size > 0) {
      let maxAdsets = 0;
      for (const [accId, adsetIds] of acctMap) {
        adsets_ativos += adsetIds.size;
        if (adsetIds.size > maxAdsets) {
          maxAdsets = adsetIds.size;
          bestAccountId = accId;
        }
      }
    }

    const emUso = adsets_ativos > 0;
    if (emUso) emUsoCount++;

    console.log(`  ${page.name} → ${emUso ? `EM USO (${adsets_ativos} adsets) [${bestAccountId}]` : 'DISPONÍVEL'}`);

    const { error: uErr } = await supabase.from('paginas').upsert({
      page_id:       pageId,
      nome:          page.name,
      foto_url:      page.picture_url,
      ad_account_id: bestAccountId,
      status:        emUso ? 'em_uso' : 'disponivel',
      adsets_ativos,
      pais_sigla:    null,
      pais_nome:     null,
      em_uso_desde:  emUso ? hoje : null,
      ultima_sync:   new Date().toISOString(),
    }, { onConflict: 'page_id' });

    if (uErr) console.warn('[syncPaginas] upsert erro:', uErr.message, '| page_id:', pageId);
  }

  console.log(`[syncPaginas] ${allPagesMap.size} páginas upseridas, ${emUsoCount} em uso.`);
}

module.exports = { syncAll, fetchAndSaveHourly, syncPaginas };
