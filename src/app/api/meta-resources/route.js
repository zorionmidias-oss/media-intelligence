'use strict';
const axios = require('axios');
const path  = require('path');
const supabase = require('../../../lib/supabase');
const { getCachedOrFetch } = require('../../../lib/meta-cache');

const META_BASE = 'https://graph.facebook.com/v19.0';

// Static data (never changes)
const COUNTRIES = require(path.join(__dirname, '../../../../scripts/data/meta-countries.json'));
const LOCALES   = require(path.join(__dirname, '../../../../scripts/data/meta-locales.json'));

// ── Helpers ────────────────────────────────────────────────────────────────────
function normalizeActId(v) {
  const s = String(v || '');
  return s.startsWith('act_') ? s : `act_${s}`;
}

async function getToken(acctId) {
  const { data } = await supabase.from('meta_accounts')
    .select('access_token').eq('ad_account_id', acctId).maybeSingle();
  return data?.access_token || null;
}

async function getAnyToken() {
  const { data } = await supabase.from('meta_accounts')
    .select('access_token').eq('ativo', true).order('id').limit(1).maybeSingle();
  return data?.access_token || null;
}

function metaErrMsg(e) {
  const raw = e.response?.data?.error;
  if (!raw) return e.message;
  const code = raw.code;
  if (code === 190) return 'Token expirado ou inválido — renove o access_token da conta';
  if (code === 100) return 'Parâmetro inválido na requisição Meta';
  if (code === 200 || code === 10) return 'Conta sem permissão para este recurso';
  if (code === 803) return 'Pixel não encontrado ou sem permissão';
  return raw.message || e.message;
}

// ── Handler ────────────────────────────────────────────────────────────────────
async function handler(req, res) {
  const resource = req.params.resource;
  const { account_id, q, page_id } = req.query;
  const acctId = account_id ? normalizeActId(account_id) : null;

  try {

    // ── G: countries — static ─────────────────────────────────────────────────
    if (resource === 'countries') {
      return res.json(COUNTRIES);
    }

    // ── H: locales — static ───────────────────────────────────────────────────
    if (resource === 'locales') {
      return res.json(LOCALES);
    }

    // For interest-search and behaviors, we only need any valid token
    if (resource === 'interest-search' || resource === 'behaviors') {
      if (resource === 'interest-search') {
        if (!q || q.trim().length < 2)
          return res.status(400).json({ erro: 'q deve ter ao menos 2 caracteres', items: [] });
        const token = acctId ? await getToken(acctId) : await getAnyToken();
        if (!token) return res.status(400).json({ erro: 'Nenhuma conta Meta com token ativo', items: [] });
        const qHash = `interest:${q.trim().toLowerCase()}`;
        const { data, fromCache } = await getCachedOrFetch('global', 'interest-search', qHash, async () => {
          const r = await axios.get(`${META_BASE}/search`, {
            params: { type: 'adinterest', q: q.trim(), limit: 20, access_token: token, locale: 'pt_BR' },
            timeout: 12000,
          });
          return (r.data?.data || []).map(i => ({
            id: i.id, name: i.name,
            audience_size: i.audience_size_lower_bound || null,
            path: i.path ? i.path.join(' > ') : null,
            description: i.description || null,
          }));
        }, 6);
        return res.json(data);
      }

      // behaviors
      const token = acctId ? await getToken(acctId) : await getAnyToken();
      if (!token) return res.status(400).json({ erro: 'Nenhuma conta Meta com token ativo', items: [] });
      const { data, fromCache } = await getCachedOrFetch('global', 'behaviors', '', async () => {
        const r = await axios.get(`${META_BASE}/search`, {
          params: { type: 'adTargetingCategory', class: 'behaviors', limit: 50, access_token: token },
          timeout: 12000,
        });
        return (r.data?.data || []).map(b => ({
          id: b.id, name: b.name,
          description: b.description || null,
          audience_size: b.audience_size || null,
        }));
      }, 12);
      return res.json(data);
    }

    // All remaining endpoints require account_id
    if (!acctId)
      return res.status(400).json({ erro: 'account_id é obrigatório', items: [], cached: false });

    const token = await getToken(acctId);
    if (!token)
      return res.status(400).json({ erro: 'Conta Meta não encontrada ou sem token', items: [], cached: false });

    // ── A: pages ──────────────────────────────────────────────────────────────
    if (resource === 'pages') {
      const { data, fromCache } = await getCachedOrFetch(acctId, 'pages', '', async () => {
        const r = await axios.get(`${META_BASE}/${acctId}/promote_pages`, {
          params: { fields: 'id,name,picture{url},category', limit: 100, access_token: token },
          timeout: 15000,
        });
        return (r.data?.data || []).map(p => ({
          id: p.id,
          name: p.name,
          picture_url: p.picture?.data?.url || null,
          category: p.category || null,
        }));
      });
      return res.json(data);
    }

    // ── B: pixels ─────────────────────────────────────────────────────────────
    if (resource === 'pixels') {
      const { data, fromCache } = await getCachedOrFetch(acctId, 'pixels', '', async () => {
        const r = await axios.get(`${META_BASE}/${acctId}/adspixels`, {
          params: { fields: 'id,name,creation_time,last_fired_time,is_unavailable', limit: 50, access_token: token },
          timeout: 15000,
        });
        const pixels = r.data?.data || [];
        // Best-effort: fetch recent events per pixel (skip on error)
        const results = await Promise.all(pixels.map(async p => {
          let eventos_disponiveis = [];
          try {
            const since7d = Math.floor((Date.now() - 7 * 86400000) / 1000);
            const sr = await axios.get(`${META_BASE}/${p.id}/stats`, {
              params: { fields: 'data_use_setting', start_time: since7d, access_token: token },
              timeout: 6000,
            });
            eventos_disponiveis = sr.data?.data?.map?.(e => e.event) || [];
          } catch (_) { /* ignore */ }
          return {
            id: p.id,
            name: p.name,
            status: p.is_unavailable ? 'UNAVAILABLE' : 'ACTIVE',
            last_fired_time: p.last_fired_time || null,
            eventos_disponiveis,
          };
        }));
        return results;
      });
      return res.json(data);
    }

    // ── C: saved-audiences ────────────────────────────────────────────────────
    if (resource === 'saved-audiences') {
      const { data, fromCache } = await getCachedOrFetch(acctId, 'saved-audiences', '', async () => {
        const r = await axios.get(`${META_BASE}/${acctId}/saved_audiences`, {
          params: { fields: 'id,name,description,run_status,approximate_count', limit: 100, access_token: token },
          timeout: 15000,
        });
        return (r.data?.data || []).map(a => ({
          id: a.id, name: a.name,
          description: a.description || null,
          size_estimate: a.approximate_count || null,
          status: a.run_status || 'ACTIVE',
        }));
      });
      return res.json(data);
    }

    // ── D: custom-audiences ───────────────────────────────────────────────────
    if (resource === 'custom-audiences') {
      const { data, fromCache } = await getCachedOrFetch(acctId, 'custom-audiences', '', async () => {
        const r = await axios.get(`${META_BASE}/${acctId}/customaudiences`, {
          params: { fields: 'id,name,subtype,approximate_count,description', limit: 100, access_token: token },
          timeout: 15000,
        });
        return (r.data?.data || []).map(a => ({
          id: a.id, name: a.name,
          subtype: a.subtype || null,
          count: a.approximate_count || null,
          description: a.description || null,
        }));
      });
      return res.json(data);
    }

    // ── I: instagram-accounts ─────────────────────────────────────────────────
    if (resource === 'instagram-accounts') {
      if (!page_id)
        return res.status(400).json({ erro: 'page_id é obrigatório', items: [], cached: false });
      const cacheKey = `ig:${page_id}`;
      const { data, fromCache } = await getCachedOrFetch(acctId, 'instagram-accounts', cacheKey, async () => {
        const r = await axios.get(`${META_BASE}/${page_id}`, {
          params: {
            fields: 'instagram_business_account{id,username,name,profile_picture_url}',
            access_token: token,
          },
          timeout: 12000,
        });
        const ig = r.data?.instagram_business_account;
        return ig ? [ig] : [];
      });
      return res.json(data);
    }

    // ── J: welcome-messages ───────────────────────────────────────────────────
    if (resource === 'welcome-messages') {
      if (!page_id)
        return res.status(400).json({ erro: 'page_id é obrigatório', items: [], cached: false });
      const cacheKey = `wm:${page_id}`;
      const { data, fromCache } = await getCachedOrFetch(acctId, 'welcome-messages', cacheKey, async () => {
        const r = await axios.get(`${META_BASE}/${page_id}/messenger_profile`, {
          params: { fields: 'ice_breakers,greeting,persistent_menu', access_token: token },
          timeout: 12000,
        });
        return r.data?.data?.[0] || {};
      });
      return res.json(data);
    }

    res.status(404).json({ erro: `Recurso desconhecido: ${resource}`, items: [], cached: false });

  } catch (err) {
    const msg = metaErrMsg(err);
    console.error(`[/api/meta-resources/${resource}]`, msg);
    res.status(500).json({ erro: msg, items: [], cached: false });
  }
}

module.exports = handler;
