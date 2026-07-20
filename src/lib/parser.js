'use strict';

// "[MKUKER] [NG_RELA_EN_BOT_0001] [JANE]" → "MKUKER"
const FIRST_BRACKET_RE = /^\[([^\]]+)\]/;

// Estrutura no INÍCIO do nome da campanha: "E1 [MKUKER] …" ou "[E2] [MKUKER] …"
// (convenção jul/2026: E<n> = número da estrutura). Precisa de espaço/colchete
// depois pra não casar nomes tipo "E10X…" colados em texto.
const ESTRUTURA_RE = /^\s*\[?\s*(E\d+)\s*\]?(?=[\s\[]|$)\s*/i;

// "E1 [MKUKER] …" → "E1" | sem estrutura → null
function extractEstrutura(campaignName) {
  const m = String(campaignName || '').match(ESTRUTURA_RE);
  return m ? m[1].toUpperCase() : null;
}

// Remove o token de estrutura para os parsers posicionais (prefixo = 1º colchete)
function stripEstrutura(name) {
  return String(name || '').replace(ESTRUTURA_RE, '');
}

// "01-janefb" → "janefb" | "02_janefb" → "janefb"
const NUM_PREFIX_RE = /^\d+[-_\s]*/;

// Non-ISO codes used by the client — Intl.DisplayNames won't resolve these
const COUNTRY_OVERRIDES = {
  AFS: { nome: 'South Africa', emoji: '🇿🇦' },
};

// Converts a 2-letter ISO code to its flag emoji via Unicode regional indicators
function siglaParaEmoji(sigla) {
  if (!sigla || sigla.length !== 2) return '🌍';
  return [...sigla.toUpperCase()]
    .map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65))
    .join('');
}

// Resolves any country code to { sigla, nome, emoji }
// Uses Intl.DisplayNames (supports any valid ISO 3166-1 alpha-2 automatically)
// Falls back to COUNTRY_OVERRIDES for non-ISO client codes (e.g. AFS)
const _countryCache = {};
function resolveCountry(sigla) {
  if (!sigla) return null;
  const key = sigla.toUpperCase();
  if (_countryCache[key]) return _countryCache[key];

  if (COUNTRY_OVERRIDES[key]) {
    return (_countryCache[key] = { sigla: key, ...COUNTRY_OVERRIDES[key] });
  }

  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    const nome = display.of(key);
    const emoji = key.length === 2 ? siglaParaEmoji(key) : '🌍';
    // Intl returns "Unknown Region" for unrecognised codes
    const resolved = (!nome || nome === key || nome === 'Unknown Region')
      ? key : nome;
    return (_countryCache[key] = { sigla: key, nome: resolved, emoji });
  } catch {
    return (_countryCache[key] = { sigla: key, nome: key, emoji: '🌍' });
  }
}

// Thin compat shim — code that does PAISES['GH'].emoji still works
const PAISES = new Proxy({}, {
  get(_, k) { return resolveCountry(k) || undefined; },
  has(_, k) { return !!resolveCountry(k); },
});

// "[MKUKER] [NG_RELA_EN_BOT_0001] [JANE]" → "NG"
// "[AFS_RELA_EN_BOT_0001]" → "AFS"  (legado)
// "[E1] [MKUKER] [AFS] [F3] …"  → "AFS"  (novo: colchete solto de 2-3 letras)
// pais_sigla faz parte da chave de upsert de ads_consolidados — se voltar vazio,
// o mesmo anúncio vira linha nova a cada sync. Por isso o fallback.
function extractPaisSigla(name) {
  if (!name) return '';
  // 1) formato legado tem prioridade: [PAIS_NICHO_...] é inequívoco
  const legado = String(name).match(/\[([A-Z]{2,3})_/);
  if (legado) return legado[1];
  // 2) novo: colchete solto de 2-3 letras. Estrutura ([E1]) e funil ([F3]) têm
  //    dígito e não casam; site longo (MKUKER) também não. Sobra o país —
  //    EXCETO quando o site também tem 2-3 letras (domínio "EU"):
  //      conjunto  [AFS] [F3] [PAG] V1          → 1 candidato  → é o país
  //      campanha  [E1] [EU] [CZ] [F3] [PAG]…   → 2 candidatos → o 2º é o país
  const soltos = [...stripEstrutura(String(name)).matchAll(/\[([^\]]*)\]/g)]
    .map(m => m[1].trim())
    .filter(b => /^[A-Z]{2,3}$/.test(b));
  if (!soltos.length) return '';
  return soltos.length > 1 ? soltos[1] : soltos[0];
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
  // Estrutura vem ANTES do prefixo ("E1 [MKUKER]…" / "[E1] [MKUKER]…") —
  // sem o strip, "[E1]" viraria prefixo de domínio e quebraria o matching
  const m = stripEstrutura(campaignName).match(FIRST_BRACKET_RE);
  return m ? m[1].trim() : null;
}

function extractAdUTM(adName) {
  if (!adName) return null;
  return String(adName).replace(NUM_PREFIX_RE, '').trim().toLowerCase() || null;
}

function extractTipo(campaignName) {
  return /direto/i.test(String(campaignName || '')) ? 'direto' : 'bot';
}

// Groups ads by (date, domainId, adUTM, accountId, paisSigla, campaignId).
// campaignId na chave: campanhas replicadas (estruturas E1/E2…) reusam os
// mesmos nomes de anúncio — sem o id, 4 campanhas com "khanyisafb" colapsavam
// numa linha só somando o gasto de todas.
// Sums spend/clicks/impressions/results.
// CPC/CTR = clicks/impressions-weighted averages.
// orcamentoTotal = sum of UNIQUE adset daily budgets in the group.
function groupAdsByUTM(ads) {
  const groups = {};

  for (const ad of ads) {
    if (!ad.adUTM) continue;
    const pais = ad.paisSigla || '';
    const key = `${ad.date}|${ad.domainId}|${ad.adUTM}|${ad.accountId || ''}|${pais}|${ad.campaignId || ''}`;

    if (!groups[key]) {
      groups[key] = {
        adUTM: ad.adUTM,
        domainId: ad.domainId,
        tipo: ad.tipo,
        date: ad.date,
        campaignName: ad.campaignName,
        campaignId: ad.campaignId || null,
        accountId: ad.accountId || null,
        paisSigla: pais,
        nicho: ad.nicho || null,
        spend: 0, clicks: 0, impressions: 0, results: 0, sessoes_meta: 0, conversas_meta: 0,
        _cpcSum: 0, _cpcW: 0,
        _ctrSum: 0, _ctrW: 0,
        _adsetBudgets: new Map(),
        _adIds: new Set(),
      };
    }

    const g = groups[key];
    if (!g.nicho && ad.nicho) g.nicho = ad.nicho;
    if (ad.adId) g._adIds.add(String(ad.adId));
    g.spend += ad.spend || 0;
    g.clicks += ad.clicks || 0;
    g.impressions += ad.impressions || 0;
    g.results += ad.results || 0;
    g.sessoes_meta  += ad.sessoes_meta  || 0;
    g.conversas_meta += ad.conversas_meta || 0;

    if ((ad.cpc || 0) > 0 && (ad.clicks || 0) > 0) {
      g._cpcSum += ad.cpc * ad.clicks;
      g._cpcW += ad.clicks;
    }
    if ((ad.ctr || 0) > 0 && (ad.impressions || 0) > 0) {
      g._ctrSum += ad.ctr * ad.impressions;
      g._ctrW += ad.impressions;
    }
    if (ad.adsetId && (ad.adsetBudget || 0) > 0) {
      g._adsetBudgets.set(ad.adsetId, ad.adsetBudget);
    }
  }

  return Object.values(groups).map(g => {
    const cpc = g.clicks > 0 ? g.spend / g.clicks : 0;
    const ctr = g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0;
    console.log(`[utm ${g.adUTM} ${g.date}] spend=${g.spend.toFixed(2)}, clicks=${g.clicks}, cpc=${cpc.toFixed(4)}`);
    return {
      adUTM: g.adUTM,
      domainId: g.domainId,
      tipo: g.tipo,
      date: g.date,
      campaignName: g.campaignName,
      campaignId: g.campaignId || null,
      accountId: g.accountId,
      paisSigla: g.paisSigla,
      nicho: g.nicho,
      spend: g.spend,
      clicks: g.clicks,
      impressions: g.impressions,
      results: g.results,
      sessoes_meta: g.sessoes_meta,
      conversas_meta: g.conversas_meta,
      cpc,
      ctr,
      orcamentoTotal: [...g._adsetBudgets.values()].reduce((a, b) => a + b, 0),
      adIds: [...g._adIds],
    };
  });
}

module.exports = { extractDomainPrefix, extractAdUTM, extractTipo, groupAdsByUTM, extractPaisSigla, extractNicho, extractEstrutura, stripEstrutura, resolveCountry, siglaParaEmoji, PAISES };
