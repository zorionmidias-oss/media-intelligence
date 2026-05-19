'use strict';
const supabase = require('./supabase');

const VALID_OBJECTIVES = [
  'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT',
  'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_APP_PROMOTION',
];

const VALID_OPT_GOALS = [
  'LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH',
  'OFFSITE_CONVERSIONS', 'LEAD_GENERATION', 'APP_INSTALLS',
  'VIDEO_VIEWS', 'REPLIES', 'POST_ENGAGEMENT',
];

async function validateTemplate(template) {
  const errors = [];

  // ── Nome ────────────────────────────────────────────────────────────────────
  const nome = template.nome?.trim() || '';
  if (nome.length < 3)
    errors.push({ field: 'nome', msg: 'Nome muito curto (mín 3 chars)' });
  if (nome.length > 80)
    errors.push({ field: 'nome', msg: 'Nome muito longo (máx 80 chars)' });
  if (/[<>"'%;()&+]/.test(nome))
    errors.push({ field: 'nome', msg: 'Nome contém caracteres inválidos' });

  // ── Tipo ────────────────────────────────────────────────────────────────────
  if (!['bot', 'direto', 'conversao'].includes(template.tipo))
    errors.push({ field: 'tipo', msg: 'Tipo inválido (bot | direto | conversao)' });

  // ── Account ─────────────────────────────────────────────────────────────────
  if (!template.account_id) {
    errors.push({ field: 'account_id', msg: 'account_id é obrigatório' });
  } else {
    const acctId = String(template.account_id).startsWith('act_')
      ? template.account_id : `act_${template.account_id}`;
    const { data: account } = await supabase
      .from('meta_accounts')
      .select('id,ativo')
      .eq('ad_account_id', acctId)
      .maybeSingle();
    if (!account) errors.push({ field: 'account_id', msg: 'Conta Meta não existe' });
    else if (!account.ativo) errors.push({ field: 'account_id', msg: 'Conta Meta desativada' });
  }

  // ── Campanha config ─────────────────────────────────────────────────────────
  const cc = template.campanha_config || {};
  if (!cc.objective)
    errors.push({ field: 'campanha_config.objective', msg: 'Objetivo da campanha é obrigatório' });
  else if (!VALID_OBJECTIVES.includes(cc.objective))
    errors.push({ field: 'campanha_config.objective', msg: `Objetivo inválido: ${cc.objective}` });

  // ── ABO vs CBO ──────────────────────────────────────────────────────────────
  const isCBO = cc.budget_mode === 'cbo';
  if (isCBO && !cc.cbo_daily_budget)
    errors.push({ field: 'cbo_daily_budget', msg: 'CBO precisa de orçamento diário (cbo_daily_budget)' });

  const jc = template.conjunto_config || {};
  if (!isCBO && !jc.abo_daily_budget)
    errors.push({ field: 'abo_daily_budget', msg: 'ABO precisa de orçamento no conjunto (abo_daily_budget)' });
  if (!isCBO && jc.abo_daily_budget) {
    const orc = Number(jc.abo_daily_budget);
    if (isNaN(orc) || orc < 1 || orc > 100000)
      errors.push({ field: 'abo_daily_budget', msg: 'Orçamento deve ser entre R$1 e R$100.000' });
  }

  // ── Conjunto: optimization_goal ─────────────────────────────────────────────
  if (!jc.optimization_goal)
    errors.push({ field: 'conjunto_config.optimization_goal', msg: 'optimization_goal é obrigatório' });
  else if (!VALID_OPT_GOALS.includes(jc.optimization_goal))
    errors.push({ field: 'conjunto_config.optimization_goal', msg: `optimization_goal inválido: ${jc.optimization_goal}` });

  // ── BOT: Messenger obrigatório ───────────────────────────────────────────────
  if (template.tipo === 'bot') {
    if (jc.destination_type !== 'MESSENGER')
      errors.push({ field: 'destination_type', msg: 'Tipo BOT precisa de destination_type=MESSENGER' });
    if (!jc.page_id)
      errors.push({ field: 'page_id', msg: 'Página do Facebook obrigatória para tipo BOT' });
  }

  // ── CONVERSÃO: pixel obrigatório ─────────────────────────────────────────────
  if (template.tipo === 'conversao') {
    if (!jc.pixel_id)
      errors.push({ field: 'pixel_id', msg: 'Pixel obrigatório para template de conversão' });
    if (!jc.custom_event_type)
      errors.push({ field: 'custom_event_type', msg: 'Evento de conversão obrigatório (ex: PURCHASE)' });
  }

  // ── Targeting: geo obrigatório ───────────────────────────────────────────────
  const geo = jc.targeting?.geo_locations;
  if (!geo?.countries?.length && !geo?.regions?.length && !geo?.cities?.length)
    errors.push({ field: 'targeting.geo_locations', msg: 'Pelo menos 1 localização geográfica é obrigatória' });

  // ── Patterns ─────────────────────────────────────────────────────────────────
  const p = template.patterns || {};
  if (!p.campaign_name)
    errors.push({ field: 'patterns.campaign_name', msg: 'patterns.campaign_name é obrigatório' });
  else if (!p.campaign_name.includes('{{utm_campaign}}'))
    errors.push({ field: 'patterns.campaign_name', msg: 'patterns.campaign_name deve conter {{utm_campaign}}' });

  if (!p.adset_name)
    errors.push({ field: 'patterns.adset_name', msg: 'patterns.adset_name é obrigatório' });
  else if (!p.adset_name.includes('{{utm_campaign}}'))
    errors.push({ field: 'patterns.adset_name', msg: 'patterns.adset_name deve conter {{utm_campaign}}' });

  if (!p.ad_name)
    errors.push({ field: 'patterns.ad_name', msg: 'patterns.ad_name é obrigatório' });

  return { valid: errors.length === 0, errors };
}

module.exports = { validateTemplate };
