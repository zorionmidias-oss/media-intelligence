'use strict';
const axios = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';
const cache = new Map(); // key → { data, expiresAt }
const CACHE_TTL = 60 * 60 * 1000; // 1h

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}
function cacheSet(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
}

async function getToken(accountId) {
  const { data } = await supabase.from('meta_accounts')
    .select('access_token').eq('ad_account_id', accountId).maybeSingle();
  return data?.access_token || null;
}

async function handler(req, res) {
  const resource = req.params.resource; // saved-audiences | pixels | interest-search | pages
  const { account_id, q } = req.query;

  try {
    // ── GET /api/meta-resources/interest-search?q=fitness ─────────────────────
    if (resource === 'interest-search') {
      if (!q) return res.status(400).json({ erro: 'q é obrigatório' });
      const cacheKey = `interest-search:${q}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);

      // Use first active account token
      const { data: acc } = await supabase.from('meta_accounts')
        .select('access_token').eq('ativo', true).order('id').limit(1).maybeSingle();
      if (!acc) return res.status(400).json({ erro: 'Nenhuma conta Meta ativa' });

      const r = await axios.get(`${META_BASE}/search`, {
        params: { type: 'adinterest', q, limit: 20, access_token: acc.access_token },
        timeout: 15000,
      });
      const result = (r.data?.data || []).map(i => ({ id: i.id, name: i.name, audience_size: i.audience_size_lower_bound }));
      cacheSet(cacheKey, result);
      return res.json(result);
    }

    // ── Account-scoped endpoints ───────────────────────────────────────────────
    if (!account_id) return res.status(400).json({ erro: 'account_id é obrigatório' });
    const acctId = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
    const token = await getToken(acctId);
    if (!token) return res.status(400).json({ erro: 'Conta Meta não encontrada ou sem token' });

    // ── GET /api/meta-resources/saved-audiences?account_id=xxx ────────────────
    if (resource === 'saved-audiences') {
      const cacheKey = `saved-audiences:${acctId}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);

      const r = await axios.get(`${META_BASE}/${acctId}/saved_audiences`, {
        params: { fields: 'id,name,approximate_count', limit: 100, access_token: token },
        timeout: 15000,
      });
      const result = r.data?.data || [];
      cacheSet(cacheKey, result);
      return res.json(result);
    }

    // ── GET /api/meta-resources/pixels?account_id=xxx ─────────────────────────
    if (resource === 'pixels') {
      const cacheKey = `pixels:${acctId}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);

      const r = await axios.get(`${META_BASE}/${acctId}/adspixels`, {
        params: { fields: 'id,name,creation_time', limit: 50, access_token: token },
        timeout: 15000,
      });
      const result = r.data?.data || [];
      cacheSet(cacheKey, result);
      return res.json(result);
    }

    // ── GET /api/meta-resources/pages?account_id=xxx ──────────────────────────
    if (resource === 'pages') {
      const cacheKey = `pages:${acctId}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);

      const r = await axios.get(`${META_BASE}/${acctId}/promote_pages`, {
        params: { fields: 'id,name,picture', limit: 50, access_token: token },
        timeout: 15000,
      });
      const result = r.data?.data || [];
      cacheSet(cacheKey, result);
      return res.json(result);
    }

    res.status(404).json({ erro: `Recurso desconhecido: ${resource}` });
  } catch (err) {
    const apiErr = err.response?.data?.error?.message || err.message;
    console.error(`[/api/meta-resources/${resource}]`, apiErr);
    res.status(500).json({ erro: apiErr });
  }
}

module.exports = handler;
