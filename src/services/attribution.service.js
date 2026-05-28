'use strict';

function findAction(arr, types) {
  if (!Array.isArray(arr)) return 0;
  for (const t of (Array.isArray(types) ? types : [types])) {
    const found = arr.find(a => a.action_type === t);
    if (found) return Number(found.value || 0);
  }
  return 0;
}

function getResults(actions) {
  return (
    findAction(actions, ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase']) ||
    findAction(actions, ['lead', 'onsite_web_lead', 'offsite_conversion.fb_pixel_lead']) ||
    findAction(actions, ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration']) ||
    findAction(actions, 'link_click')
  );
}

// BUG 5: landing_page_view e omni_landing_page_view são o mesmo evento (alias).
// Usar APENAS o primeiro encontrado — nunca somar. Ordem garante fallback sem duplicar.
const OBJECTIVE_ACTION_MAP = {
  'OUTCOME_LEADS':      ['lead', 'onsite_conversion.lead_grouped'],
  'LEAD_GENERATION':    ['lead'],
  'OUTCOME_SALES':      ['purchase', 'omni_purchase'],
  'CONVERSIONS':        ['offsite_conversion.fb_pixel_purchase', 'purchase'],
  'OUTCOME_TRAFFIC':    ['landing_page_view', 'omni_landing_page_view', 'link_click'],
  'LINK_CLICKS':        ['landing_page_view', 'omni_landing_page_view', 'link_click'],
  'PAGE_VIEW':          ['landing_page_view', 'omni_landing_page_view'],
  'OUTCOME_AWARENESS':  ['impressions'],
  'OUTCOME_ENGAGEMENT': ['post_engagement'],
};

// BUG 2: Para campanhas BOT o objetivo é "Visualização de conteúdo" = view_content na API.
// NÃO é landing_page_view (que não existe nessas campanhas).
// view_content, omni_view_content e offsite_conversion.fb_pixel_view_content têm o mesmo valor
// — usar somente o primeiro encontrado, NUNCA somar.
function getResultadoMeta(ad, tipo) {
  const actions = ad.actions || [];

  if (tipo === 'bot') {
    const vc = actions.find(a => a.action_type === 'view_content');
    if (vc) return Number(vc.value);
    const ovc = actions.find(a => a.action_type === 'omni_view_content');
    if (ovc) return Number(ovc.value);
    const fpvc = actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_view_content');
    if (fpvc) return Number(fpvc.value);
    return 0;
  }

  // Direto e demais: usa mapa de objetivo do Meta
  const objetivo = ad.objective || ad.optimization_goal;
  const expected = OBJECTIVE_ACTION_MAP[objetivo] || ['link_click'];
  for (const type of expected) {
    const found = actions.find(a => a.action_type === type);
    if (found) return Number(found.value);
  }
  return Number(ad.clicks || 0);
}

module.exports = { findAction, getResults, OBJECTIVE_ACTION_MAP, getResultadoMeta };
