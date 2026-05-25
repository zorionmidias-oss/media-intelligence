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

// ── Payload builders ──────────────────────────────────────────────────────────

function buildCampaignBody(campaign, status) {
  const body = {
    name: campaign.name,
    objective: campaign.objective || 'OUTCOME_SALES',
    status: status || 'PAUSED',
    special_ad_categories: [],
    buying_type: 'AUCTION',
  };
  if (campaign.budget_type === 'CBO') {
    body.daily_budget = campaign.daily_budget || undefined;
  } else {
    // ABO: ad sets own the budget
    body.is_adset_budget_sharing_enabled = false;
  }
  return body;
}

function buildAdsetBody(acctId, template, name, campaign_id, page_id) {
  const targeting = {
    geo_locations: template.geo_locations || { countries: ['BR'] },
    age_min: template.age_min || 18,
  };
  if (template.age_max && template.age_max < 65) targeting.age_max = template.age_max;
  if (template.locales?.length)       targeting.locales = template.locales;
  if (template.genders?.length)       targeting.genders = template.genders;
  if (template.interests?.length)
    targeting.flexible_spec = [{ interests: template.interests }];
  if (template.custom_audiences?.length)
    targeting.custom_audiences = template.custom_audiences.map(a =>
      typeof a === 'string' ? { id: a } : a
    );

  const body = {
    name,
    campaign_id: campaign_id || '<CAMPAIGN_ID>',
    daily_budget: template.daily_budget,
    promoted_object: {
      pixel_id: template.pixel_id,
      custom_event_type: template.conversion_event || 'CONTENT_VIEW',
      page_id: page_id || undefined,
    },
    destination_type: 'MESSENGER',
    optimization_goal: 'OFFSITE_CONVERSIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: { ...targeting, targeting_automation: { advantage_audience: 0 } },
    status: 'PAUSED',
    start_time: template.start_time,
  };
  if (template.end_time) body.end_time = template.end_time;
  return body;
}

function buildCreativeBody(creative, copies, page_id, conversation_config) {
  const body = {
    name: creative.name,
    object_story_spec: {
      page_id,
      link_data: {
        message: copies.texts[0],
        name: copies.headlines[0],
        image_hash: creative.image_hash,
        call_to_action: {
          type: 'MESSAGE_PAGE',
          value: { app_destination: 'MESSENGER' },
        },
      },
    },
  };
  if (conversation_config) body.object_story_spec.page_welcome_message = conversation_config;
  return body;
}

// ── dry-run ───────────────────────────────────────────────────────────────────
async function dryRunHandler(req, res) {
  try {
    const { account_id, campaign, adset_template, adset_names, adset_creatives, copies, page_id, conversation_config, url_tags } = req.body || {};

    if (!account_id || !campaign)
      return res.status(400).json({ error: 'account_id e campaign são obrigatórios' });

    const acctId = normalizeActId(account_id);
    const names  = adset_names || ['<ADSET_NAME>'];
    const cp     = copies || { texts: ['<TEXT>'], headlines: ['<HEADLINE>'], descriptions: ['<DESC>'] };
    const tpl    = adset_template || {};

    const steps = [{
      step: 1,
      description: 'Criar Campanha',
      endpoint: `POST ${META_BASE}/${acctId}/campaigns`,
      body: buildCampaignBody(campaign, campaign.status || 'PAUSED'),
    }];

    let totalAds = 0;
    names.forEach((name, i) => {
      const crs = (adset_creatives && adset_creatives[i]?.length)
        ? adset_creatives[i]
        : [{ name: '<CREATIVE>', image_hash: '<HASH>' }];
      steps.push({
        step: steps.length + 1,
        description: `Criar Conjunto V${i + 1}: ${name}`,
        endpoint: `POST ${META_BASE}/${acctId}/adsets`,
        body: buildAdsetBody(acctId, tpl, name, '<CAMPAIGN_ID>', page_id),
      });
      crs.forEach(cr => {
        steps.push({
          step: steps.length + 1,
          description: `Criar Criativo ${cr.name} (conjunto ${i + 1})`,
          endpoint: `POST ${META_BASE}/${acctId}/adcreatives`,
          body: buildCreativeBody(cr, cp, page_id || '<PAGE_ID>', conversation_config || null),
        });
        steps.push({
          step: steps.length + 1,
          description: `Criar Ad ${cr.name} (conjunto ${i + 1})`,
          endpoint: `POST ${META_BASE}/${acctId}/ads`,
          body: {
            name: cr.name,
            adset_id: '<ADSET_ID>',
            creative: { creative_id: '<CREATIVE_ID>' },
            status: 'PAUSED',
            tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [tpl.pixel_id || '<PIXEL>'] }],
            ...(url_tags ? { url_tags } : {}),
          },
        });
        totalAds++;
      });
    });

    return res.json({
      dry_run: true,
      note: 'Nenhuma chamada à Meta API foi realizada',
      summary: {
        campaign: campaign.name,
        adsets: names.length,
        total_ads: totalAds,
        creatives_per_adset: (adset_creatives || []).map((v, i) => `V${i + 1}:${v.length}`).join(' '),
      },
      steps,
    });
  } catch (e) {
    console.error('[dry-run]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ── criar — SSE streaming ─────────────────────────────────────────────────────
async function criarHandler(req, res) {
  const { account_id, campaign, adset_template, adset_names, adset_creatives, copies, page_id, conversation_config, url_tags } = req.body || {};

  if (!account_id || !campaign || !adset_template || !adset_names?.length || !adset_creatives?.length || !copies)
    return res.status(400).json({ error: 'Payload incompleto: account_id, campaign, adset_template, adset_names, adset_creatives e copies são obrigatórios' });

  const acctId = normalizeActId(account_id);
  const token  = await getToken(acctId);
  if (!token)
    return res.status(400).json({ error: 'Conta Meta não encontrada ou sem token' });

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  let campaign_id = null;
  const adset_ids = [];
  const ad_ids    = [];

  const rollback = async () => {
    if (!campaign_id) return;
    try {
      await axios.post(`${META_BASE}/${campaign_id}`, { status: 'DELETED', access_token: token }, { timeout: 15000 });
      console.log(`[criar] rollback: campanha ${campaign_id} deletada`);
    } catch (e) {
      console.error('[criar] rollback falhou:', e.response?.data?.error?.message || e.message);
    }
  };

  let currentStepName = 'init';

  const metaPost = async (url, body, label) => {
    currentStepName = label;
    const bodyWithoutToken = { ...body };
    delete bodyWithoutToken.access_token;
    console.log(`\n[criar] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ${label}`);
    console.log(`[criar] URL    : POST ${url}`);
    console.log(`[criar] PAYLOAD: ${JSON.stringify(bodyWithoutToken, null, 2)}`);
    try {
      const res = await axios.post(url, body, { timeout: 20000 });
      console.log(`[criar] ✓ OK   : HTTP ${res.status} → id=${res.data?.id}`);
      return res;
    } catch (e) {
      const status  = e.response?.status ?? 'NO_RESPONSE';
      const headers = e.response?.headers ?? {};
      const raw     = e.response?.data;
      console.error(`[criar] ✗ ERRO : HTTP ${status}`);
      console.error(`[criar] HEADERS: ${JSON.stringify({ 'content-type': headers['content-type'], 'x-fb-req-id': headers['x-fb-req-id'] })}`);
      console.error(`[criar] BODY   : ${JSON.stringify(raw, null, 2)}`);
      console.error(`[criar] MSG    : ${e.message}`);
      if (raw?.error) {
        const err = raw.error;
        console.error(`[criar] META_CODE    : ${err.code}`);
        console.error(`[criar] META_SUBCODE : ${err.error_subcode ?? '—'}`);
        console.error(`[criar] META_TYPE    : ${err.type}`);
        console.error(`[criar] META_USER_MSG: ${err.error_user_msg ?? '—'}`);
        console.error(`[criar] META_TRACE   : ${err.fbtrace_id ?? '—'}`);
      }
      const msg = raw?.error?.message || e.message;
      throw Object.assign(new Error(msg), { stepName: label, httpStatus: status, metaError: raw?.error });
    }
  };

  try {
    const totalSteps = 1 + adset_names.length + adset_creatives.reduce((s, v) => s + (v.length * 2), 0);
    let step = 0;

    // PASSO 1 — Campanha
    send('progress', { msg: 'Criando campanha…', step: step++, total: totalSteps });
    const cpBody = { ...buildCampaignBody(campaign, campaign.status || 'PAUSED'), access_token: token };
    const cpRes = await metaPost(`${META_BASE}/${acctId}/campaigns`, cpBody, 'Criar Campanha');
    campaign_id = cpRes.data?.id;
    if (!campaign_id) throw new Error('Meta não retornou campaign_id');
    send('progress', { msg: `Campanha criada (${campaign_id})`, step: step++, total: totalSteps });

    // PASSO 2-N — Conjuntos + Criativos por conjunto
    for (let i = 0; i < adset_names.length; i++) {
      const name = adset_names[i];
      const creatives = adset_creatives[i] || [];
      send('progress', { msg: `Criando conjunto ${i + 1} de ${adset_names.length}: ${name}`, step: step++, total: totalSteps });

      const asBody = { ...buildAdsetBody(acctId, adset_template, name, campaign_id, page_id), access_token: token };
      const asRes  = await metaPost(`${META_BASE}/${acctId}/adsets`, asBody, `Conjunto V${i + 1}`);
      const adset_id = asRes.data?.id;
      if (!adset_id) throw new Error(`Meta não retornou adset_id para ${name}`);
      adset_ids.push(adset_id);

      for (let j = 0; j < creatives.length; j++) {
        const cr = creatives[j];
        send('progress', { msg: `Criando criativo ${cr.name} (V${i + 1}, ${j + 1}/${creatives.length})`, step: step++, total: totalSteps });

        const crBody = { ...buildCreativeBody(cr, copies, page_id, conversation_config || null), access_token: token };
        const crRes  = await metaPost(`${META_BASE}/${acctId}/adcreatives`, crBody, `Criativo ${cr.name} V${i + 1}`);
        const creative_id = crRes.data?.id;
        if (!creative_id) throw new Error(`Meta não retornou creative_id para ${cr.name}`);

        const adBody = {
          name: cr.name,
          adset_id,
          creative: { creative_id },
          status: 'PAUSED',
          tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [adset_template.pixel_id] }],
          access_token: token,
        };
        if (url_tags) adBody.url_tags = url_tags;

        const adBodyLog = { ...adBody };
        delete adBodyLog.access_token;
        console.log(`\n[criar] >>> AD BODY EXATO (antes de enviar) <<<`);
        console.log(JSON.stringify(adBodyLog, null, 2));

        const adRes = await metaPost(`${META_BASE}/${acctId}/ads`, adBody, `Ad ${cr.name} V${i + 1}`);
        const ad_id = adRes.data?.id;
        if (!ad_id) throw new Error(`Meta não retornou ad_id para ${cr.name}`);
        ad_ids.push(ad_id);
        send('progress', { msg: `Ad ${cr.name} criado (V${i + 1})`, step: step++, total: totalSteps });
      }
    }

    try {
      await supabase.from('historico_campanhas').insert({
        account_id: acctId, campaign_id,
        campaign_name: campaign.name,
        status: 'success', erro: null, payload: req.body,
      });
    } catch (logErr) { console.error('[criar] log failed:', logErr.message); }

    const rawId = acctId.replace('act_', '');
    send('done', {
      success: true,
      campaign_id,
      adset_count: adset_ids.length,
      ad_count: ad_ids.length,
      meta_url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${rawId}`,
    });

  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    console.error('[criar] falhou:', errMsg);
    await rollback();
    try {
      await supabase.from('historico_campanhas').insert({
        account_id: acctId, campaign_id,
        campaign_name: campaign?.name,
        status: 'failed', erro: errMsg, payload: req.body,
      });
    } catch (_) {}
    send('error', {
      error: errMsg,
      campaign_id,
      step_failed: e.stepName || currentStepName,
      http_status: e.httpStatus || null,
      meta_error: e.metaError || null,
    });
  } finally {
    res.end();
  }
}

module.exports = { dryRunHandler, criarHandler };
