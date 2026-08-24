'use strict';
/*
 * Export por CONJUNTO DE ANÚNCIO (adset_id) × dia.
 *
 * Gera dois CSVs em exports/:
 *   - meta_por_conjunto.csv  → Meta Insights FRESCO em level=adset (spend, impressões,
 *                              cpm, ctr link, cliques link, frequência, alcance, conversas,
 *                              custo/conversa) + snapshot de status/orçamento diário por adset.
 *   - gam_por_conjunto.csv   → GAM por conjunto lido de receita_ads (dashboard): receita
 *                              bruta, receita líquida (×0.9), impressões, cliques, eCPM.
 *
 * Uso:
 *   $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/export-por-conjunto.js [SINCE] [UNTIL]
 *   (SINCE/UNTIL em yyyy-mm-dd; default = janela dos dados: 2026-07-22 → hoje BR)
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DateTime } = require('luxon');
const supabase = require('../src/lib/supabase');
const { getBMConfigs } = require('../src/lib/meta');
const { fetchAll } = require('../src/lib/fetchAll');
const { hojeBR } = require('../src/lib/datas');

const BASE = 'https://graph.facebook.com/v19.0';
const OUT_DIR = path.join(__dirname, '..', 'exports');

const SINCE = process.argv[2] || '2026-07-22';
const UNTIL = process.argv[3] || hojeBR();

// action_type que representa "conversa por mensagem iniciada"
const MSG_ACTIONS = new Set([
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
]);

// ── CSV helper ────────────────────────────────────────────────────────────
function toCSV(rows, cols) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = cols.join(',');
  const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

// ── Meta: insights level=adset, time_increment=1, com fallback dia-a-dia ────
async function fetchAdsetInsights(accountId, token) {
  const fields = [
    'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'account_id',
    'spend', 'impressions', 'reach', 'frequency', 'cpm',
    'inline_link_clicks', 'inline_link_click_ctr', 'ctr', 'cost_per_inline_link_click',
    'actions',
  ].join(',');

  async function page(params) {
    const rows = [];
    let url = `${BASE}/${accountId}/insights`;
    let p = { access_token: token, level: 'adset', time_increment: 1, limit: 500, fields, ...params };
    while (url) {
      const res = await axios.get(url, { params: p, timeout: 90000 });
      rows.push(...(res.data?.data || []));
      url = (res.data?.data?.length && res.data?.paging?.next) ? res.data.paging.next : null;
      p = undefined;
    }
    return rows;
  }

  try {
    return await page({ time_range: JSON.stringify({ since: SINCE, until: UNTIL }) });
  } catch (e) {
    if (e.response?.status !== 400) throw e;
    console.warn(`  [${accountId}] range rejeitado (400) — fallback dia a dia`);
    const rows = [];
    let cur = DateTime.fromISO(SINCE);
    const end = DateTime.fromISO(UNTIL);
    while (cur <= end) {
      const d = cur.toISODate();
      try {
        rows.push(...await page({ time_range: JSON.stringify({ since: d, until: d }) }));
      } catch {
        await new Promise(r => setTimeout(r, 3000));
        rows.push(...await page({ time_range: JSON.stringify({ since: d, until: d }) }));
      }
      cur = cur.plus({ days: 1 });
    }
    return rows;
  }
}

// Snapshot atual de status + orçamento diário por adset (não é histórico por dia)
async function fetchAdsetSnapshot(accountId, token) {
  const map = {};
  let url = `${BASE}/${accountId}/adsets`;
  let p = { access_token: token, fields: 'id,name,daily_budget,status,effective_status', limit: 500 };
  while (url) {
    const res = await axios.get(url, { params: p, timeout: 60000 });
    for (const a of res.data?.data || []) {
      map[a.id] = {
        status: a.effective_status || a.status || '',
        orcamento_diario: a.daily_budget != null ? Number(a.daily_budget) / 100 : '', // centavos → unidade
      };
    }
    url = (res.data?.data?.length && res.data?.paging?.next) ? res.data.paging.next : null;
    p = undefined;
  }
  return map;
}

function sumMsgActions(actions) {
  if (!Array.isArray(actions)) return 0;
  let n = 0;
  for (const a of actions) if (MSG_ACTIONS.has(a.action_type)) n += Number(a.value || 0);
  return n;
}

async function exportMeta() {
  const configs = await getBMConfigs();
  const out = [];
  for (const cfg of configs) {
    const accountId = String(cfg.account).startsWith('act_') ? cfg.account : `act_${cfg.account}`;
    console.log(`[meta] conta ${cfg.nome || cfg.id} (${accountId})…`);
    const [rows, snap] = await Promise.all([
      fetchAdsetInsights(accountId, cfg.token),
      fetchAdsetSnapshot(accountId, cfg.token).catch(e => { console.warn('  snapshot falhou:', e.message); return {}; }),
    ]);
    console.log(`  ${rows.length} linhas adset×dia`);
    for (const r of rows) {
      const conversas = sumMsgActions(r.actions);
      const spend = Number(r.spend || 0);
      out.push({
        data: r.date_start,
        conta: cfg.nome || accountId,
        account_id: (r.account_id || accountId).replace('act_', ''),
        campaign_id: r.campaign_id || '',
        campaign_name: r.campaign_name || '',
        adset_id: r.adset_id || '',
        adset_name: r.adset_name || '',
        gasto: +spend.toFixed(2),
        impressoes: Number(r.impressions || 0),
        alcance: Number(r.reach || 0),
        frequencia: r.frequency != null ? +Number(r.frequency).toFixed(4) : '',
        cpm: r.cpm != null ? +Number(r.cpm).toFixed(2) : '',
        cliques_link: Number(r.inline_link_clicks || 0),
        ctr_link: r.inline_link_click_ctr != null ? +Number(r.inline_link_click_ctr).toFixed(4) : '',
        ctr_todos: r.ctr != null ? +Number(r.ctr).toFixed(4) : '',
        cpc_link: r.cost_per_inline_link_click != null ? +Number(r.cost_per_inline_link_click).toFixed(4) : '',
        conversas,
        custo_conversa: conversas > 0 ? +(spend / conversas).toFixed(4) : '',
        status_atual: snap[r.adset_id]?.status || '',
        orcamento_diario_atual: snap[r.adset_id]?.orcamento_diario ?? '',
      });
    }
  }
  out.sort((a, b) => (a.data + a.adset_id).localeCompare(b.data + b.adset_id));
  const cols = ['data','conta','account_id','campaign_id','campaign_name','adset_id','adset_name',
    'gasto','impressoes','alcance','frequencia','cpm','cliques_link','ctr_link','ctr_todos','cpc_link',
    'conversas','custo_conversa','status_atual','orcamento_diario_atual'];
  fs.writeFileSync(path.join(OUT_DIR, 'meta_por_conjunto.csv'), toCSV(out, cols));
  console.log(`[meta] → exports/meta_por_conjunto.csv (${out.length} linhas)\n`);
  return out;
}

// ── GAM por conjunto: receita_ads (dashboard) agregado por adset_id × dia ────
async function exportGAM() {
  const { data, error } = await fetchAll(() =>
    supabase.from('receita_ads')
      .select('data,adset_id,campaign_id,receita_bruta,impressoes,cliques')
      .gte('data', SINCE).lte('data', UNTIL)
  );
  if (error) { console.warn('[gam] erro receita_ads:', error.message); return []; }
  const agg = {};
  for (const r of data) {
    if (!r.adset_id) continue;
    const k = `${r.data}|${r.adset_id}`;
    const a = agg[k] || (agg[k] = {
      data: r.data, adset_id: r.adset_id, campaign_id: r.campaign_id || '',
      receita_bruta: 0, impressoes_gam: 0, cliques_gam: 0,
    });
    a.receita_bruta += Number(r.receita_bruta || 0);
    a.impressoes_gam += Number(r.impressoes || 0);
    a.cliques_gam += Number(r.cliques || 0);
  }
  const out = Object.values(agg).map(a => ({
    data: a.data,
    adset_id: a.adset_id,
    campaign_id: a.campaign_id,
    receita_gam_bruta: +a.receita_bruta.toFixed(2),
    receita_gam_liquida: +(a.receita_bruta * 0.9).toFixed(2), // invariante: líquida = bruta × 0.9
    impressoes_gam: a.impressoes_gam,
    cliques_gam: a.cliques_gam,
    ecpm_gam: a.impressoes_gam > 0 ? +((a.receita_bruta / a.impressoes_gam) * 1000).toFixed(2) : '',
  }));
  out.sort((x, y) => (x.data + x.adset_id).localeCompare(y.data + y.adset_id));
  const cols = ['data','adset_id','campaign_id','receita_gam_bruta','receita_gam_liquida','impressoes_gam','cliques_gam','ecpm_gam'];
  fs.writeFileSync(path.join(OUT_DIR, 'gam_por_conjunto.csv'), toCSV(out, cols));
  console.log(`[gam] → exports/gam_por_conjunto.csv (${out.length} linhas)\n`);
  return out;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Janela: ${SINCE} → ${UNTIL}\n`);
  await exportMeta();
  await exportGAM();
  console.log('OK.');
})().catch(e => { console.error(e); process.exit(1); });
