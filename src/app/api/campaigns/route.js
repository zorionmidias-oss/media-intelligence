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
  return {
    name: campaign.name,
    objective: 'MESSAGES',
    status: status || 'PAUSED',
    special_ad_categories: [],
    buying_type: 'AUCTION',
  };
}

function buildAdsetBody(acctId, template, name, campaign_id) {
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
      custom_event_type: template.conversion_event || 'VIEW_CONTENT',
    },
    destination_type: 'MESSENGER_INBOX',
    optimization_goal: 'CONVERSATIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting,
    status: 'PAUSED',
    start_time: template.start_time,
  };
  if (template.end_time) body.end_time = template.end_time;
  return body;
}

function buildDynamicCreativeBody(creative, copies, page_id, link_url) {
  return {
    name: creative.name,
    object_story_spec: {
      page_id,
      link_data: {
        message: copies.texts[0],
        name: copies.headlines[0],
        link: link_url,
        image_hash: creative.image_hash,
        call_to_action: {
          type: 'SEND_MESSAGE',
          value: { app_destination: 'MESSENGER' },
        },
      },
    },
    asset_feed_spec: {
      bodies:       copies.texts.map(text => ({ text })),
      titles:       copies.headlines.map(text => ({ text })),
      descriptions: copies.descriptions.map(text => ({ text })),
      images:       [{ hash: creative.image_hash }],
      call_to_action_types: ['MESSAGE_PAGE'],
      optimization_type: 'DEGREES_OF_FREEDOM',
    },
  };
}

// ── dry-run ───────────────────────────────────────────────────────────────────
async function dryRunHandler(req, res) {
  try {
    const { account_id, campaign, adset_template, adset_names, creatives, copies, page_id, link_url, url_tags } = req.body || {};

    if (!account_id || !campaign)
      return res.status(400).json({ error: 'account_id e campaign são obrigatórios' });

    const acctId = normalizeActId(account_id);
    const names = adset_names || ['<ADSET_NAME>'];
    const crs   = creatives || [{ name: '<CREATIVE>', image_hash: '<HASH>' }];
    const cp    = copies || { texts: ['<TEXT>'], headlines: ['<HEADLINE>'], descriptions: ['<DESC>'] };
    const tpl   = adset_template || {};

    const steps = [{
      step: 1,
      description: 'Criar Campanha',
      endpoint: `POST ${META_BASE}/${acctId}/campaigns`,
      body: buildCampaignBody(campaign, campaign.status || 'PAUSED'),
    }];

    names.forEach((name, i) => {
      steps.push({
        step: steps.length + 1,
        description: `Criar Conjunto V${i + 1}: ${name}`,
        endpoint: `POST ${META_BASE}/${acctId}/adsets`,
        body: buildAdsetBody(acctId, tpl, name, '<CAMPAIGN_ID>'),
      });
      crs.forEach(cr => {
        steps.push({
          step: steps.length + 1,
          description: `Criar Criativo ${cr.name} (conjunto ${i + 1})`,
          endpoint: `POST ${META_BASE}/${acctId}/adcreatives`,
          body: buildDynamicCreativeBody(cr, cp, page_id || '<PAGE_ID>', link_url || '<LINK_URL>'),
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
      });
    });

    return res.json({
      dry_run: true,
      note: 'Nenhuma chamada à Meta API foi realizada',
      summary: {
        campaign: campaign.name,
        adsets: names.length,
        creatives_per_adset: crs.length,
        total_ads: names.length * crs.length,
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
  const { account_id, campaign, adset_template, adset_names, creatives, copies, page_id, link_url, url_tags } = req.body || {};

  if (!account_id || !campaign || !adset_template || !adset_names?.length || !creatives?.length || !copies)
    return res.status(400).json({ error: 'Payload incompleto: account_id, campaign, adset_template, adset_names, creatives e copies são obrigatórios' });

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
      await axios.delete(`${META_BASE}/${campaign_id}`, { params: { access_token: token }, timeout: 15000 });
      console.log(`[criar] rollback: campanha ${campaign_id} deletada`);
    } catch (e) {
      console.error('[criar] rollback falhou:', e.message);
    }
  };

  try {
    const total = 1 + adset_names.length * (1 + creatives.length * 2);
    let step = 0;

    // PASSO 1 — Campanha
    send('progress', { msg: 'Criando campanha…', step: step++, total });
    const cpRes = await axios.post(
      `${META_BASE}/${acctId}/campaigns`,
      { ...buildCampaignBody(campaign, campaign.status || 'PAUSED'), access_token: token },
      { timeout: 20000 }
    );
    campaign_id = cpRes.data?.id;
    if (!campaign_id) throw new Error('Meta não retornou campaign_id');
    send('progress', { msg: `Campanha criada (${campaign_id})`, step: step++, total });

    // PASSO 2-N — Conjuntos + Criativos
    for (let i = 0; i < adset_names.length; i++) {
      const name = adset_names[i];
      send('progress', { msg: `Criando conjunto ${i + 1} de ${adset_names.length}: ${name}`, step: step++, total });

      const asBody = buildAdsetBody(acctId, adset_template, name, campaign_id);
      const asRes  = await axios.post(
        `${META_BASE}/${acctId}/adsets`,
        { ...asBody, access_token: token },
        { timeout: 20000 }
      );
      const adset_id = asRes.data?.id;
      if (!adset_id) throw new Error(`Meta não retornou adset_id para ${name}`);
      adset_ids.push(adset_id);
      send('progress', { msg: `Conjunto V${i + 1} criado`, step: step++, total });

      for (let j = 0; j < creatives.length; j++) {
        const cr = creatives[j];
        send('progress', { msg: `Criando criativo ${cr.name} (conjunto ${i + 1}, criativo ${j + 1}/${creatives.length})`, step: step++, total });

        const crBody = buildDynamicCreativeBody(cr, copies, page_id, link_url);
        const crRes  = await axios.post(
          `${META_BASE}/${acctId}/adcreatives`,
          { ...crBody, access_token: token },
          { timeout: 20000 }
        );
        const creative_id = crRes.data?.id;
        if (!creative_id) throw new Error(`Meta não retornou creative_id para ${cr.name}`);

        const adBody = {
          name: cr.name,
          adset_id,
          creative: { creative_id },
          status: 'PAUSED',
          tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [adset_template.pixel_id] }],
        };
        if (url_tags) adBody.url_tags = url_tags;

        const adRes = await axios.post(
          `${META_BASE}/${acctId}/ads`,
          { ...adBody, access_token: token },
          { timeout: 20000 }
        );
        const ad_id = adRes.data?.id;
        if (!ad_id) throw new Error(`Meta não retornou ad_id para ${cr.name}`);
        ad_ids.push(ad_id);
        send('progress', { msg: `Ad ${cr.name} criado (adset V${i + 1})`, step: step++, total });
      }
    }

    await supabase.from('historico_campanhas').insert({
      account_id: acctId, campaign_id,
      campaign_name: campaign.name,
      status: 'success', erro: null, payload: req.body,
    }).catch(e => console.error('[criar] log failed:', e.message));

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
    await supabase.from('historico_campanhas').insert({
      account_id: acctId, campaign_id,
      campaign_name: campaign?.name,
      status: 'failed', erro: errMsg, payload: req.body,
    }).catch(() => {});
    send('error', { error: errMsg, campaign_id });
  } finally {
    res.end();
  }
}

module.exports = { dryRunHandler, criarHandler };
