'use strict';
const axios    = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';

function normalizeActId(v) {
  const s = String(v || '');
  return s.startsWith('act_') ? s : `act_${s}`;
}

async function getToken(acctId) {
  const { data } = await supabase.from('meta_accounts')
    .select('access_token').eq('ad_account_id', acctId).maybeSingle();
  return data?.access_token || null;
}

// ── Build Meta payloads from wizard input ──────────────────────────────────────
function buildCampaignPayload({ account_id, campaign }) {
  return {
    endpoint: `POST ${META_BASE}/${account_id}/campaigns`,
    body: {
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status || 'PAUSED',
      special_ad_categories: [],
      buying_type: 'AUCTION',
    },
  };
}

function buildAdsetPayload({ account_id, adset }, campaign_id) {
  const targeting = {
    geo_locations: adset.geo_locations || { countries: ['BR'] },
    age_min: adset.age_min || 18,
    age_max: adset.age_max || 65,
  };
  if (adset.locales?.length) targeting.locales = adset.locales;
  if (adset.genders?.length) targeting.genders = adset.genders;
  if (adset.interests?.length)
    targeting.flexible_spec = [{ interests: adset.interests }];
  if (adset.custom_audiences?.length)
    targeting.custom_audiences = adset.custom_audiences.map(id =>
      typeof id === 'string' ? { id } : id
    );

  const body = {
    name: adset.name,
    campaign_id: campaign_id || '<CAMPAIGN_ID>',
    daily_budget: adset.daily_budget,
    promoted_object: {
      pixel_id: adset.pixel_id,
      custom_event_type: adset.conversion_event || 'VIEW_CONTENT',
    },
    destination_type: 'MESSENGER_INBOX',
    optimization_goal: adset.optimization_goal || 'CONVERSATIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: adset.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
    targeting,
    status: 'PAUSED',
    start_time: adset.start_time,
  };
  if (adset.end_time) body.end_time = adset.end_time;
  return { endpoint: `POST ${META_BASE}/${account_id}/adsets`, body };
}

function buildCreativePayload({ account_id, ad }, adset_id) {
  const link_data = {
    message: ad.message,
    name: ad.headline,
    link: ad.link_url,
    image_hash: ad.image_hash,
    call_to_action: {
      type: 'SEND_MESSAGE',
      value: { app_destination: 'MESSENGER' },
    },
  };

  const body = {
    name: ad.name,
    object_story_spec: {
      page_id: ad.page_id,
      link_data,
    },
  };

  if (ad.url_tags) body.url_tags = ad.url_tags;

  if (ad.conversation_template_id) {
    body.template_url_spec = {
      config: { app_id: '966242223397198' },
      ios: { url: `https://fb.me/m/${ad.page_id}` },
      android: { url: `https://fb.me/m/${ad.page_id}` },
      web: {
        url: ad.link_url,
        should_fallback: true,
      },
    };
  }

  return { endpoint: `POST ${META_BASE}/${account_id}/adcreatives`, body };
}

function buildAdPayload({ account_id, ad, adset }, adset_id, creative_id, pixel_id) {
  return {
    endpoint: `POST ${META_BASE}/${account_id}/ads`,
    body: {
      name: ad.name,
      adset_id: adset_id || '<ADSET_ID>',
      creative: { creative_id: creative_id || '<CREATIVE_ID>' },
      status: 'PAUSED',
      tracking_specs: [
        {
          'action.type': ['offsite_conversion'],
          fb_pixel: [pixel_id || adset.pixel_id],
        },
      ],
    },
  };
}

// ── ETAPA 5: dry-run ──────────────────────────────────────────────────────────
async function dryRunHandler(req, res) {
  try {
    const body = req.body || {};
    const { account_id, campaign, adset, ad } = body;

    if (!account_id || !campaign || !adset || !ad)
      return res.status(400).json({ error: 'account_id, campaign, adset e ad são obrigatórios' });

    const acctId = normalizeActId(account_id);

    const campaignPayload  = buildCampaignPayload({ account_id: acctId, campaign });
    const adsetPayload     = buildAdsetPayload({ account_id: acctId, adset }, null);
    const creativePayload  = buildCreativePayload({ account_id: acctId, ad }, null);
    const adPayload        = buildAdPayload({ account_id: acctId, ad, adset }, null, null, adset.pixel_id);

    return res.json({
      dry_run: true,
      note: 'Nenhuma chamada à Meta API foi realizada',
      steps: [
        { step: 1, description: 'Criar Campanha', ...campaignPayload },
        { step: 2, description: 'Criar Ad Set', ...adsetPayload },
        { step: 3, description: 'Criar Ad Creative', ...creativePayload },
        { step: 4, description: 'Criar Ad', ...adPayload },
      ],
    });
  } catch (e) {
    console.error('[dry-run]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ── ETAPA 6: criar (atomic with rollback) ─────────────────────────────────────
async function criarHandler(req, res) {
  const body = req.body || {};
  const { account_id, campaign, adset, ad } = body;

  if (!account_id || !campaign || !adset || !ad)
    return res.status(400).json({ error: 'account_id, campaign, adset e ad são obrigatórios' });

  const acctId = normalizeActId(account_id);
  const token  = await getToken(acctId);
  if (!token)
    return res.status(400).json({ error: 'Conta Meta não encontrada ou sem token' });

  let campaign_id = null;
  let adset_id    = null;
  let creative_id = null;
  let ad_id       = null;

  async function rollback(reason) {
    if (campaign_id) {
      try {
        await axios.delete(`${META_BASE}/${campaign_id}`, {
          params: { access_token: token }, timeout: 15000,
        });
        console.log(`[criar] rollback: campanha ${campaign_id} deletada`);
      } catch (e) {
        console.error(`[criar] rollback failed for campaign ${campaign_id}:`, e.message);
      }
    }
    await supabase.from('historico_campanhas').insert({
      account_id: acctId,
      campaign_id, adset_id, creative_id, ad_id,
      campaign_name: campaign.name,
      status: 'failed',
      erro: reason,
      payload: body,
    }).catch(e => console.error('[criar] log failed:', e.message));
  }

  try {
    // PASSO 1 — Campanha
    const cpBody = buildCampaignPayload({ account_id: acctId, campaign }).body;
    const cpRes  = await axios.post(`${META_BASE}/${acctId}/campaigns`,
      { ...cpBody, access_token: token }, { timeout: 20000 });
    campaign_id = cpRes.data?.id;
    if (!campaign_id) throw new Error('Meta não retornou campaign_id');
    console.log(`[criar] campanha criada: ${campaign_id}`);

    // PASSO 2 — Ad Set
    const asBody = buildAdsetPayload({ account_id: acctId, adset }, campaign_id).body;
    const asRes  = await axios.post(`${META_BASE}/${acctId}/adsets`,
      { ...asBody, access_token: token }, { timeout: 20000 });
    adset_id = asRes.data?.id;
    if (!adset_id) throw new Error('Meta não retornou adset_id');
    console.log(`[criar] adset criado: ${adset_id}`);

    // PASSO 3 — Ad Creative
    const crBody = buildCreativePayload({ account_id: acctId, ad }, adset_id).body;
    const crRes  = await axios.post(`${META_BASE}/${acctId}/adcreatives`,
      { ...crBody, access_token: token }, { timeout: 20000 });
    creative_id = crRes.data?.id;
    if (!creative_id) throw new Error('Meta não retornou creative_id');
    console.log(`[criar] creative criado: ${creative_id}`);

    // PASSO 4 — Ad
    const adBody = buildAdPayload({ account_id: acctId, ad, adset }, adset_id, creative_id, adset.pixel_id).body;
    const adRes  = await axios.post(`${META_BASE}/${acctId}/ads`,
      { ...adBody, access_token: token }, { timeout: 20000 });
    ad_id = adRes.data?.id;
    if (!ad_id) throw new Error('Meta não retornou ad_id');
    console.log(`[criar] ad criado: ${ad_id}`);

    // Log sucesso
    await supabase.from('historico_campanhas').insert({
      account_id: acctId,
      campaign_id, adset_id, creative_id, ad_id,
      campaign_name: campaign.name,
      status: 'success',
      erro: null,
      payload: body,
    }).catch(e => console.error('[criar] log failed:', e.message));

    const rawId = acctId.replace('act_', '');
    return res.json({
      success: true,
      campaign_id, adset_id, creative_id, ad_id,
      meta_url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${rawId}`,
    });

  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    console.error('[criar] falhou:', errMsg);
    await rollback(errMsg);
    return res.status(500).json({ error: errMsg, campaign_id, adset_id, creative_id, ad_id });
  }
}

module.exports = { dryRunHandler, criarHandler };
