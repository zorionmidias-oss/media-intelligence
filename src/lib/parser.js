'use strict';

// "[MKUKER] [NG_RELA_EN_BOT_0001] [JANE]" → "MKUKER"
const FIRST_BRACKET_RE = /^\[([^\]]+)\]/;

// "01-janefb" → "janefb" | "02_janefb" → "janefb"
const NUM_PREFIX_RE = /^\d+[-_\s]*/;

// Country code lookup: ISO 3166-1 alpha-2 siglas encontradas nas campanhas
const PAISES = {
  GH: { nome: 'Ghana',           emoji: '🇬🇭' },
  NG: { nome: 'Nigeria',         emoji: '🇳🇬' },
  SN: { nome: 'Senegal',         emoji: '🇸🇳' },
  KE: { nome: 'Kenya',           emoji: '🇰🇪' },
  ZA: { nome: 'South Africa',    emoji: '🇿🇦' },
  TZ: { nome: 'Tanzania',        emoji: '🇹🇿' },
  UG: { nome: 'Uganda',          emoji: '🇺🇬' },
  ET: { nome: 'Ethiopia',        emoji: '🇪🇹' },
  CI: { nome: "Côte d'Ivoire",   emoji: '🇨🇮' },
  CM: { nome: 'Cameroon',        emoji: '🇨🇲' },
  CD: { nome: 'DR Congo',        emoji: '🇨🇩' },
  MG: { nome: 'Madagascar',      emoji: '🇲🇬' },
  MZ: { nome: 'Mozambique',      emoji: '🇲🇿' },
  AO: { nome: 'Angola',          emoji: '🇦🇴' },
  RW: { nome: 'Rwanda',          emoji: '🇷🇼' },
  ZM: { nome: 'Zambia',          emoji: '🇿🇲' },
  ZW: { nome: 'Zimbabwe',        emoji: '🇿🇼' },
  MA: { nome: 'Morocco',         emoji: '🇲🇦' },
  AFS: { nome: 'South Africa',   emoji: '🇿🇦' },
};

// "[MKUKER] [NG_RELA_EN_BOT_0001] [JANE]" → "NG"
// Matches first occurrence of "[XX_" where XX = 2-3 uppercase letters
function extractPaisSigla(name) {
  if (!name) return '';
  const m = String(name).match(/\[([A-Z]{2,3})_/);
  return m ? m[1] : '';
}

// "[GH_RELA_EN_BOT_0001]" → "RELA"  |  "[NG_NEWS_EN_BOT_0002]" → "NEWS"
function extractNicho(adsetName, campaignName) {
  for (const name of [adsetName, campaignName]) {
    if (!name) continue;
    const m = String(name).match(/\[[A-Z]{2,3}_([A-Z]+)_/);
    if (m) return m[1];
  }
  return null;
}

function extractDomainPrefix(campaignName) {
  if (!campaignName) return null;
  const m = String(campaignName).match(FIRST_BRACKET_RE);
  return m ? m[1].trim() : null;
}

function extractAdUTM(adName) {
  if (!adName) return null;
  return String(adName).replace(NUM_PREFIX_RE, '').trim().toLowerCase() || null;
}

function extractTipo(campaignName) {
  return /direto/i.test(String(campaignName || '')) ? 'direto' : 'bot';
}

// Groups ads by (date, domainId, adUTM, accountId, paisSigla).
// Sums spend/clicks/impressions/results.
// CPC/CTR = clicks/impressions-weighted averages.
// orcamentoTotal = sum of UNIQUE adset daily budgets in the group.
function groupAdsByUTM(ads) {
  const groups = {};

  for (const ad of ads) {
    if (!ad.adUTM) continue;
    const pais = ad.paisSigla || '';
    const key = `${ad.date}|${ad.domainId}|${ad.adUTM}|${ad.accountId || ''}|${pais}`;

    if (!groups[key]) {
      groups[key] = {
        adUTM: ad.adUTM,
        domainId: ad.domainId,
        tipo: ad.tipo,
        date: ad.date,
        campaignName: ad.campaignName,
        accountId: ad.accountId || null,
        paisSigla: pais,
        nicho: ad.nicho || null,
        spend: 0, clicks: 0, impressions: 0, results: 0,
        _cpcSum: 0, _cpcW: 0,
        _ctrSum: 0, _ctrW: 0,
        _adsetBudgets: new Map(), // adset_id → daily_budget (dedup)
      };
    }

    const g = groups[key];
    if (!g.nicho && ad.nicho) g.nicho = ad.nicho;
    g.spend += ad.spend || 0;
    g.clicks += ad.clicks || 0;
    g.impressions += ad.impressions || 0;
    g.results += ad.results || 0;

    if ((ad.cpc || 0) > 0 && (ad.clicks || 0) > 0) {
      g._cpcSum += ad.cpc * ad.clicks;
      g._cpcW += ad.clicks;
    }
    if ((ad.ctr || 0) > 0 && (ad.impressions || 0) > 0) {
      g._ctrSum += ad.ctr * ad.impressions;
      g._ctrW += ad.impressions;
    }
    // Track unique adset budgets so we sum them once per adset
    if (ad.adsetId && (ad.adsetBudget || 0) > 0) {
      g._adsetBudgets.set(ad.adsetId, ad.adsetBudget);
    }
  }

  return Object.values(groups).map(g => {
    // CPC = total_spend / total_clicks (weighted — avoids artifacts from ads with 0 clicks)
    const cpc = g.clicks > 0 ? g.spend / g.clicks : 0;
    // CTR = total_clicks / total_impressions × 100
    const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
    console.log(`[utm ${g.adUTM} ${g.date}] spend=${g.spend.toFixed(2)}, clicks=${g.clicks}, cpc=${cpc.toFixed(4)}`);
    return {
      adUTM: g.adUTM,
      domainId: g.domainId,
      tipo: g.tipo,
      date: g.date,
      campaignName: g.campaignName,
      accountId: g.accountId,
      paisSigla: g.paisSigla,
      nicho: g.nicho,
      spend: g.spend,
      clicks: g.clicks,
      impressions: g.impressions,
      results: g.results,
      cpc,
      ctr,
      orcamentoTotal: [...g._adsetBudgets.values()].reduce((a, b) => a + b, 0),
    };
  });
}

module.exports = { extractDomainPrefix, extractAdUTM, extractTipo, groupAdsByUTM, extractPaisSigla, extractNicho, PAISES };
