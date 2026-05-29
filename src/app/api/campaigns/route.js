'use strict';
const axios    = require('axios');
const supabase = require('../../../lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';

function normalizeActId(v) {
  const s = String(v || '');
  return s.startsWith('act_') ? s : `act_${s}`;
}

async function getAccountInfo(acctId) {
  const { data } = await supabase.from('meta_accounts')
    .select('access_token, currency, timezone_name').eq('ad_account_id', acctId).maybeSingle();
  return data || null;
}

// ── Domínio helpers ──────────────────────────────────────────────────────────

async function getDominioPrefixo(dominio_id) {
  if (!dominio_id) return null;
  const { data } = await supabase.from('dominios')
    .select('prefixo_campanha').eq('id', dominio_id).maybeSingle();
  return data?.prefixo_campanha || null;
}

// Normaliza payload: aceita novo formato `campanhas` OU legado single-campaign
function normalizeCampanhas(body) {
  if (Array.isArray(body.campanhas) && body.campanhas.length) return body.campanhas;
  // backward compat: payload antigo com campaign/adset_names/adset_creatives no nível raiz
  return [{
    campaign:        body.campaign,
    adset_names:     body.adset_names,
    adset_creatives: body.adset_creatives,
  }];
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

function tzOffsetStr(ianaTimezone, dateStr) {
  const ref = new Date(dateStr + 'T12:00:00Z');
  const parts = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(ref).forEach(p => { if (p.type !== 'literal') parts[p.type] = p.value; });
  const h = parts.hour === '24' ? '00' : parts.hour;
  const localAsUTC = new Date(`${parts.year}-${parts.month}-${parts.day}T${h}:${parts.minute}:${parts.second}Z`);
  const offsetMin = Math.round((localAsUTC - ref) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function buildStartTimeISO(dateStr, ianaTimezone) {
  if (!dateStr) return undefined;
  return `${dateStr}T00:00:00${tzOffsetStr(ianaTimezone, dateStr)}`;
}

async function resolveTimezone(acctId, token, cached) {
  if (cached) return cached;
  const r = await axios.get(`${META_BASE}/${acctId}`, {
    params: { fields: 'timezone_name', access_token: token },
    timeout: 10000,
  });
  const tz = r.data?.timezone_name;
  if (!tz) throw new Error('Meta não retornou timezone_name para a conta');
  console.log(`[criar] timezone fetched from Meta API: ${tz}`);
  await supabase.from('meta_accounts').update({ timezone_name: tz }).eq('ad_account_id', acctId);
  return tz;
}

async function getExchangeRate() {
  const { data } = await supabase.from('taxas_cambio')
    .select('taxa, data').order('data', { ascending: false }).limit(1).maybeSingle();
  return data ? parseFloat(data.taxa) : null;
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
      smart_pse_enabled: false,
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
  const link_data = {
    message: copies.texts[0],
    name: copies.headlines[0],
    ...(copies.descriptions?.[0] ? { description: copies.descriptions[0] } : {}),
    image_hash: creative.image_hash,
    link: 'https://fb.com/messenger_doc/',
    call_to_action: {
      type: 'MESSAGE_PAGE',
      value: { app_destination: 'MESSENGER' },
    },
  };
  if (conversation_config) {
    const pwm = conversation_config.page_welcome_message;
    link_data.page_welcome_message = JSON.stringify({
      type: 'VISUAL_EDITOR',
      version: 2,
      landing_screen_type: 'welcome_message',
      media_type: 'text',
      text_format: {
        customer_action_type: 'ice_breakers',
        message: {
          text: pwm.greeting[0].text,
          ice_breakers: pwm.ice_breakers.map(b => ({ title: b.question, response: null })),
          quick_replies: [],
        },
      },
      reengagement: {
        text: 'Hi {{user_first_name}}! We wanted to follow up. Do you have any questions?',
        include_products: false,
      },
      reengagement_disabled: false,
      performance_booster_enabled: true,
    });
  }
  return {
    name: creative.name,
    object_story_spec: { page_id, link_data },
  };
}

// ── DIRETO payload builders ───────────────────────────────────────────────────

function buildAdsetBodyDireto(acctId, template, name, campaign_id) {
  const targeting = {
    geo_locations: template.geo_locations || { countries: ['BR'] },
    age_min: template.age_min || 18,
  };
  if (template.age_max && template.age_max < 65) targeting.age_max = template.age_max;
  if (template.locales?.length)           targeting.locales = template.locales;
  if (template.genders?.length)           targeting.genders = template.genders;
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
      custom_event_type: 'OTHER',
      custom_conversion_id: template.custom_conversion_id || '1187119583443241',
      smart_pse_enabled: false,
    },
    optimization_goal: 'OFFSITE_CONVERSIONS',
    billing_event: 'IMPRESSIONS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: { ...targeting, targeting_automation: { advantage_audience: 1 } },
    attribution_spec: [
      { event_type: 'CLICK_THROUGH', window_days: 7 },
      { event_type: 'VIEW_THROUGH',  window_days: 1 },
    ],
    status: 'PAUSED',
    start_time: template.start_time,
  };
  if (template.end_time) body.end_time = template.end_time;
  return body;
}

function buildCreativeBodyDireto(creative, copies, page_id, url_destino) {
  const utm_source = creative.name;
  const dest_url = url_destino
    ? `${url_destino}${url_destino.includes('?') ? '&' : '?'}utm_source=${encodeURIComponent(utm_source)}`
    : `https://example.com?utm_source=${encodeURIComponent(utm_source)}`;

  const link_data = {
    message: copies.texts[0],
    name: copies.headlines[0],
    ...(copies.descriptions?.[0] ? { description: copies.descriptions[0] } : {}),
    link: dest_url,
    call_to_action: { type: 'LEARN_MORE' },
  };

  if (creative.video_id) {
    link_data.video_id = creative.video_id;
    if (creative.image_hash) link_data.image_hash = creative.image_hash; // thumbnail
  } else if (creative.image_hash) {
    link_data.image_hash = creative.image_hash;
  }

  return {
    name: creative.name,
    object_story_spec: { page_id, link_data },
  };
}

// ── dry-run ───────────────────────────────────────────────────────────────────
async function dryRunHandler(req, res) {
  try {
    const {
      account_id, type, dominio_id, adset_template, copies, page_id,
      conversation_config, url_tags, url_destino,
    } = req.body || {};
    const isDireto = type === 'DIRETO';

    if (!account_id)
      return res.status(400).json({ error: 'account_id é obrigatório' });

    const acctId = normalizeActId(account_id);
    const cp     = copies || { texts: ['<TEXT>'], headlines: ['<HEADLINE>'], descriptions: ['<DESC>'] };
    const tpl    = adset_template || {};

    // Valida prefixo_campanha no backend (não confiar apenas no frontend)
    const prefixo_campanha = await getDominioPrefixo(dominio_id);

    // Normaliza para array de campanhas
    const campanhas = normalizeCampanhas(req.body);

    const campanhaResults = [];
    let totalAdsets = 0;
    let totalAds = 0;

    for (let ci = 0; ci < campanhas.length; ci++) {
      const camp = campanhas[ci];
      if (!camp || !camp.campaign) {
        campanhaResults.push({ campaign_name: `<campanha ${ci + 1}>`, steps: [], total_ads: 0, error: 'campaign ausente' });
        continue;
      }

      const names = camp.adset_names || ['<ADSET_NAME>'];
      const steps = [{
        step: 1,
        description: 'Criar Campanha',
        endpoint: `POST ${META_BASE}/${acctId}/campaigns`,
        body: buildCampaignBody(camp.campaign, camp.campaign.status || 'PAUSED'),
      }];

      let campAds = 0;
      names.forEach((name, i) => {
        const crs = (camp.adset_creatives && camp.adset_creatives[i]?.length)
          ? camp.adset_creatives[i]
          : [{ name: '<CREATIVE>', image_hash: '<HASH>' }];
        steps.push({
          step: steps.length + 1,
          description: `Criar Conjunto ${i + 1}: ${name}`,
          endpoint: `POST ${META_BASE}/${acctId}/adsets`,
          body: isDireto
            ? buildAdsetBodyDireto(acctId, tpl, name, '<CAMPAIGN_ID>')
            : buildAdsetBody(acctId, tpl, name, '<CAMPAIGN_ID>', page_id),
        });
        crs.forEach(cr => {
          steps.push({
            step: steps.length + 1,
            description: `Criar Criativo ${cr.name} (conjunto ${i + 1})`,
            endpoint: `POST ${META_BASE}/${acctId}/adcreatives`,
            body: isDireto
              ? buildCreativeBodyDireto(cr, cp, page_id || '<PAGE_ID>', url_destino || '')
              : buildCreativeBody(cr, cp, page_id || '<PAGE_ID>', conversation_config || null),
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
          campAds++;
        });
      });

      totalAdsets += names.length;
      totalAds    += campAds;
      campanhaResults.push({
        campaign_name: camp.campaign.name,
        adsets: names.length,
        total_ads: campAds,
        creatives_per_adset: (camp.adset_creatives || []).map((v, i) => `V${i + 1}:${v.length}`).join(' '),
        steps,
      });
    }

    return res.json({
      dry_run: true,
      note: 'Nenhuma chamada à Meta API foi realizada',
      prefixo_campanha,
      summary: {
        total_campanhas: campanhas.length,
        total_adsets:    totalAdsets,
        total_ads:       totalAds,
      },
      campanhas: campanhaResults,
      // backward compat: se for 1 campanha, expõe campos no nível raiz também
      ...(campanhas.length === 1 ? {
        steps:                campanhaResults[0]?.steps || [],
        campaign:             campanhaResults[0]?.campaign_name,
        adsets:               campanhaResults[0]?.adsets,
        total_ads:            campanhaResults[0]?.total_ads,
        creatives_per_adset:  campanhaResults[0]?.creatives_per_adset,
      } : {}),
    });
  } catch (e) {
    console.error('[dry-run]', e.message);
    res.status(500).json({ error: e.message });
  }
}

// ── criar — SSE streaming ─────────────────────────────────────────────────────
async function criarHandler(req, res) {
  const {
    account_id, type, dominio_id, adset_template, copies, page_id,
    conversation_config, url_tags, url_destino,
  } = req.body || {};
  const isDireto = type === 'DIRETO';

  if (!isDireto) console.log('[criar] conversation_config recebido:', JSON.stringify(req.body.conversation_config));

  const campanhas = normalizeCampanhas(req.body);

  if (!account_id || !adset_template || !copies || !campanhas.length)
    return res.status(400).json({ error: 'Payload incompleto: account_id, adset_template, copies e campanhas são obrigatórios' });

  for (let ci = 0; ci < campanhas.length; ci++) {
    const c = campanhas[ci];
    if (!c?.campaign || !c?.adset_names?.length || !c?.adset_creatives?.length)
      return res.status(400).json({ error: `Campanha ${ci + 1}: campaign, adset_names e adset_creatives são obrigatórios` });
  }

  const acctId   = normalizeActId(account_id);
  const acctInfo = await getAccountInfo(acctId);
  if (!acctInfo?.access_token)
    return res.status(400).json({ error: 'Conta Meta não encontrada ou sem token' });
  const token    = acctInfo.access_token;
  const currency = (acctInfo.currency || 'BRL').toUpperCase();

  // Timezone: cache DB ou busca na Meta API
  const timezone = await resolveTimezone(acctId, token, acctInfo.timezone_name);
  console.log(`[criar] timezone: ${timezone}`);

  // Budget: wizard envia BRL centavos; converter para USD se conta for USD
  let dailyBudget = adset_template.daily_budget;
  if (currency === 'USD') {
    const taxa = await getExchangeRate();
    if (!taxa)
      return res.status(500).json({ error: 'Taxa de câmbio USD/BRL não disponível — atualize taxas_cambio' });
    const brlFloat = dailyBudget / 100;
    const usdFloat = Math.round((brlFloat / taxa) * 100) / 100;
    dailyBudget = Math.round(usdFloat * 100);
    console.log(`[criar] budget USD: R$${brlFloat} ÷ ${taxa} = $${usdFloat} → ${dailyBudget} cents`);
  }

  // start_time / end_time: recalcular offset com timezone real da conta
  const startDateStr = adset_template.start_time?.slice(0, 10);
  const endDateStr   = adset_template.end_time?.slice(0, 10) || null;
  const startTime    = buildStartTimeISO(startDateStr, timezone);
  const endTime      = endDateStr ? buildStartTimeISO(endDateStr, timezone) : null;
  console.log(`[criar] start_time → ${startTime}`);
  if (endTime) console.log(`[criar] end_time   → ${endTime}`);

  const resolvedTemplate = {
    ...adset_template,
    daily_budget: dailyBudget,
    start_time: startTime,
    end_time: endTime,
  };

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  // Helper para chamadas à Meta API (fechado sobre token e send)
  const makeMetaPost = () => {
    let currentStepName = 'init';
    const metaPost = async (url, body, label) => {
      currentStepName = label;
      const bodyWithoutToken = { ...body };
      delete bodyWithoutToken.access_token;
      console.log(`\n[criar] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ${label}`);
      console.log(`[criar] URL    : POST ${url}`);
      console.log(`[criar] PAYLOAD: ${JSON.stringify(bodyWithoutToken, null, 2)}`);
      try {
        const r = await axios.post(url, body, { timeout: 20000 });
        console.log(`[criar] ✓ OK   : HTTP ${r.status} → id=${r.data?.id}`);
        return r;
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
        throw Object.assign(new Error(msg), { stepName: currentStepName, httpStatus: status, metaError: raw?.error });
      }
    };
    return metaPost;
  };

  const successes = [];
  const failures  = [];

  for (let ci = 0; ci < campanhas.length; ci++) {
    const camp      = campanhas[ci];
    const { campaign, adset_names, adset_creatives } = camp;
    const cpLabel   = `CP${String(ci + 1).padStart(2, '0')}`;
    const metaPost  = makeMetaPost();

    send('progress', { msg: `[${ci + 1}/${campanhas.length}] Criando campanha ${cpLabel}: ${campaign.name}…` });

    let campaign_id = null;

    const rollbackCamp = async () => {
      if (!campaign_id) return;
      try {
        await axios.post(`${META_BASE}/${campaign_id}`, { status: 'DELETED', access_token: token }, { timeout: 15000 });
        console.log(`[criar] rollback: campanha ${campaign_id} (${cpLabel}) deletada`);
      } catch (e) {
        console.error(`[criar] rollback ${cpLabel} falhou:`, e.response?.data?.error?.message || e.message);
      }
    };

    try {
      const totalSteps = 1 + adset_names.length + adset_creatives.reduce((s, v) => s + (v.length * 2), 0);
      let step = 0;

      // PASSO 1 — Campanha
      send('progress', { msg: `[${ci + 1}/${campanhas.length}] ${cpLabel}: Criando estrutura da campanha…`, step: step++, total: totalSteps });
      const cpBody = { ...buildCampaignBody(campaign, campaign.status || 'PAUSED'), access_token: token };
      const cpRes  = await metaPost(`${META_BASE}/${acctId}/campaigns`, cpBody, `Criar Campanha ${cpLabel}`);
      campaign_id  = cpRes.data?.id;
      if (!campaign_id) throw new Error('Meta não retornou campaign_id');
      send('progress', { msg: `[${ci + 1}/${campanhas.length}] ${cpLabel}: Campanha criada (${campaign_id})`, step: step++, total: totalSteps });

      // PASSO 2-N — Conjuntos + Criativos
      const adset_ids = [];
      const ad_ids    = [];

      for (let i = 0; i < adset_names.length; i++) {
        const name      = adset_names[i];
        const creatives = adset_creatives[i] || [];
        send('progress', { msg: `[${ci + 1}/${campanhas.length}] ${cpLabel}: Conjunto ${i + 1}/${adset_names.length}: ${name}`, step: step++, total: totalSteps });

        const asBody = isDireto
          ? { ...buildAdsetBodyDireto(acctId, resolvedTemplate, name, campaign_id), access_token: token }
          : { ...buildAdsetBody(acctId, resolvedTemplate, name, campaign_id, page_id), access_token: token };
        const asRes  = await metaPost(`${META_BASE}/${acctId}/adsets`, asBody, `Conjunto V${i + 1} (${cpLabel})`);
        const adset_id = asRes.data?.id;
        if (!adset_id) throw new Error(`Meta não retornou adset_id para ${name}`);
        adset_ids.push(adset_id);

        for (let j = 0; j < creatives.length; j++) {
          const cr = creatives[j];
          send('progress', { msg: `[${ci + 1}/${campanhas.length}] ${cpLabel}: Criativo ${cr.name} (V${i + 1}, ${j + 1}/${creatives.length})`, step: step++, total: totalSteps });

          if (!isDireto) console.log('[criar] conversation_config para criativo:', JSON.stringify(conversation_config));
          const crBody = isDireto
            ? { ...buildCreativeBodyDireto(cr, copies, page_id, url_destino || ''), access_token: token }
            : { ...buildCreativeBody(cr, copies, page_id, conversation_config || null), access_token: token };
          console.log(`[criar] adcreative payload: ${JSON.stringify({ ...crBody, access_token: '[REDACTED]' })}`);
          const crRes  = await metaPost(`${META_BASE}/${acctId}/adcreatives`, crBody, `Criativo ${cr.name} V${i + 1} (${cpLabel})`);
          const creative_id = crRes.data?.id;
          if (!creative_id) throw new Error(`Meta não retornou creative_id para ${cr.name}`);

          const adBody = {
            name: cr.name,
            adset_id,
            creative: { creative_id },
            status: 'PAUSED',
            tracking_specs: [{ 'action.type': ['offsite_conversion'], fb_pixel: [resolvedTemplate.pixel_id] }],
            access_token: token,
          };
          if (url_tags) adBody.url_tags = url_tags;

          const adBodyLog = { ...adBody };
          delete adBodyLog.access_token;
          console.log(`\n[criar] >>> AD BODY EXATO (${cpLabel}, V${i+1}) <<<`);
          console.log(JSON.stringify(adBodyLog, null, 2));

          const adRes = await metaPost(`${META_BASE}/${acctId}/ads`, adBody, `Ad ${cr.name} V${i + 1} (${cpLabel})`);
          const ad_id = adRes.data?.id;
          if (!ad_id) throw new Error(`Meta não retornou ad_id para ${cr.name}`);
          ad_ids.push(ad_id);
          send('progress', { msg: `[${ci + 1}/${campanhas.length}] ${cpLabel}: Ad ${cr.name} criado (V${i + 1})`, step: step++, total: totalSteps });
        }
      }

      // Log de sucesso
      try {
        await supabase.from('historico_campanhas').insert({
          account_id: acctId, campaign_id,
          campaign_name: campaign.name,
          status: 'success', erro: null,
          payload: { ...req.body, _campanha_idx: ci },
        });
      } catch (logErr) { console.error('[criar] log failed:', logErr.message); }

      const rawId = acctId.replace('act_', '');
      successes.push({
        campaign_id,
        campaign_name: campaign.name,
        adset_count: adset_ids.length,
        ad_count: ad_ids.length,
        meta_url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${rawId}`,
      });
      send('progress', { msg: `[${ci + 1}/${campanhas.length}] ✓ ${cpLabel} criada — ${ad_ids.length} ads` });

    } catch (e) {
      const errMsg = e.response?.data?.error?.message || e.message;
      console.error(`[criar] ${cpLabel} falhou:`, errMsg);
      await rollbackCamp();
      try {
        await supabase.from('historico_campanhas').insert({
          account_id: acctId, campaign_id,
          campaign_name: campaign?.name,
          status: 'failed', erro: errMsg,
          payload: { ...req.body, _campanha_idx: ci },
        });
      } catch (_) {}
      failures.push({
        campaign_name: campaign?.name,
        error: errMsg,
        campaign_id,
        step_failed: e.stepName,
        http_status: e.httpStatus || null,
        meta_error:  e.metaError || null,
      });
      send('progress', { msg: `[${ci + 1}/${campanhas.length}] ✗ ${cpLabel} falhou — ${errMsg.slice(0, 80)}` });
    }
  }

  const totalAds = successes.reduce((s, c) => s + c.ad_count, 0);
  const first    = successes[0];

  if (successes.length > 0) {
    send('done', {
      success: true,
      // backward compat: campos da primeira campanha no nível raiz
      campaign_id:  first.campaign_id,
      adset_count:  first.adset_count,
      ad_count:     first.ad_count,
      meta_url:     first.meta_url,
      // multi-campaign summary
      total_ads:    totalAds,
      successes,
      failures,
    });
  } else {
    const errMsg = failures.map(f => `${f.campaign_name}: ${f.error}`).join('; ');
    send('error', {
      error:    errMsg,
      failures,
      campaign_id:  failures[0]?.campaign_id || null,
      step_failed:  failures[0]?.step_failed || null,
      http_status:  failures[0]?.http_status || null,
      meta_error:   failures[0]?.meta_error  || null,
    });
  }

  res.end();
}

module.exports = { dryRunHandler, criarHandler };
