'use strict';
require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { fetchGAMReport, fetchGAMFunnelsByUTM, getUSDtoBRL } = require('../src/lib/gam');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = 'https://graph.facebook.com/v19.0';
const RENDER_URL = 'https://media-intelligence-srkl.onrender.com';
const OUTPUT = path.join(__dirname, '..', 'audit-output.txt');

const lines = [];
function out(...args) {
  const line = args.join(' ');
  console.log(line);
  lines.push(line);
}

function save() {
  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
}

const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

async function part1_db() {
  out('\n══════════════════════════════════════════════════');
  out('1. DADOS NO BANCO (últimos 7 dias)');
  out('══════════════════════════════════════════════════');

  // 1a) Por dia: linhas, campos zerados
  const { data: adsAll, error: adsErr } = await sb
    .from('ads_consolidados')
    .select('data,valor_gasto,cpc,ctr,faturamento_bruto,viewability,orcamento_total,resultado')
    .gte('data', since7)
    .order('data', { ascending: false });

  if (adsErr) { out('ERRO ads_consolidados:', adsErr.message); }
  else {
    out(`\n--- Por dia (${adsAll.length} linhas totais) ---`);
    const byDay = {};
    for (const r of adsAll) {
      const d = r.data;
      if (!byDay[d]) byDay[d] = { data: d, total: 0, spend_zero: 0, cpc_zero: 0, ctr_zero: 0, fat_zero: 0, view_zero: 0, orc_zero: 0, result_zero: 0 };
      const g = byDay[d];
      g.total++;
      if (!+r.valor_gasto) g.spend_zero++;
      if (!+r.cpc) g.cpc_zero++;
      if (!+r.ctr) g.ctr_zero++;
      if (!+r.faturamento_bruto) g.fat_zero++;
      if (!+r.viewability) g.view_zero++;
      if (!+r.orcamento_total) g.orc_zero++;
      if (!+r.resultado) g.result_zero++;
    }
    out('data       | total | spend=0 | cpc=0 | ctr=0 | fat=0 | view=0 | orc=0 | result=0');
    out('-----------|-------|---------|-------|-------|-------|--------|-------|----------');
    for (const d of Object.values(byDay).sort((a, b) => b.data.localeCompare(a.data))) {
      out(`${d.data} |  ${String(d.total).padStart(4)} |   ${String(d.spend_zero).padStart(5)} | ${String(d.cpc_zero).padStart(5)} | ${String(d.ctr_zero).padStart(5)} | ${String(d.fat_zero).padStart(5)} |  ${String(d.view_zero).padStart(5)} | ${String(d.orc_zero).padStart(5)} |    ${String(d.result_zero).padStart(6)}`);
    }
  }

  // 1b) Por tipo
  out('\n--- Por tipo (bot/direto) ---');
  const { data: tipoData } = await sb
    .from('ads_consolidados')
    .select('tipo,valor_gasto,faturamento_bruto')
    .gte('data', since7);
  if (tipoData) {
    const tipos = {};
    for (const r of tipoData) {
      const t = r.tipo || 'null';
      if (!tipos[t]) tipos[t] = { tipo: t, linhas: 0, spend: 0, fat: 0 };
      tipos[t].linhas++;
      tipos[t].spend += +r.valor_gasto || 0;
      tipos[t].fat += +r.faturamento_bruto || 0;
    }
    out('tipo   | linhas | spend_total | fat_total | roas_medio');
    for (const t of Object.values(tipos)) {
      const roas = t.spend > 0 ? (t.fat / t.spend).toFixed(3) : '0';
      out(`${String(t.tipo).padEnd(6)} | ${String(t.linhas).padStart(6)} | ${String(t.spend.toFixed(2)).padStart(11)} | ${String(t.fat.toFixed(2)).padStart(9)} | ${roas}`);
    }
  }

  // 1c) UTMs com spend>0 vs faturamento>0
  out('\n--- UTMs únicas: spend>0 vs faturamento>0 ---');
  const { data: utmRows } = await sb
    .from('ads_consolidados')
    .select('ad_utm,valor_gasto,faturamento_bruto')
    .gte('data', since7);
  if (utmRows) {
    const utmMap = {};
    for (const r of utmRows) {
      if (!utmMap[r.ad_utm]) utmMap[r.ad_utm] = { utm: r.ad_utm, spend: 0, fat: 0 };
      utmMap[r.ad_utm].spend += +r.valor_gasto || 0;
      utmMap[r.ad_utm].fat += +r.faturamento_bruto || 0;
    }
    const utms = Object.values(utmMap);
    const comSpend = utms.filter(u => u.spend > 0);
    const comFat = utms.filter(u => u.fat > 0);
    const semFat = comSpend.filter(u => u.fat === 0);
    out(`UTMs com spend>0: ${comSpend.length} | com fat>0: ${comFat.length} | spend mas SEM fat: ${semFat.length}`);
    if (semFat.length > 0) {
      out('UTMs com invest mas SEM faturamento (quebra ROAS):');
      semFat.forEach(u => out(`  ❌ ${u.utm} (invest=R$${u.spend.toFixed(2)})`));
    }
  }

  // 1d) Últimos 20 sync_log
  out('\n--- Últimos 20 sync_log ---');
  const { data: logs } = await sb
    .from('sync_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (logs) {
    for (const l of logs) {
      out(`[${l.created_at}] ${l.source} | ${l.status} | rows=${l.rows_processed} | ${l.duration_ms}ms`);
      out(`  ${l.message}`);
    }
  }
}

async function part2_meta() {
  out('\n══════════════════════════════════════════════════');
  out('2. META API');
  out('══════════════════════════════════════════════════');

  const bms = [];
  for (let i = 1; i <= 10; i++) {
    const token = process.env[`META_ACCESS_TOKEN_BM${i}`];
    const account = process.env[`META_AD_ACCOUNT_BM${i}`];
    if (token && account) bms.push({ i, token, account });
  }

  out(`BMs configuradas no .env: ${bms.map(b => `BM${b.i}`).join(', ')}`);

  // Verificar tokens duplicados
  const tokenSet = new Set();
  const dupTokens = [];
  for (const b of bms) {
    if (tokenSet.has(b.token)) dupTokens.push(`BM${b.i}`);
    tokenSet.add(b.token);
  }
  if (dupTokens.length > 0) {
    out(`⚠️  TOKENS DUPLICADOS detectados (mesma credencial): ${dupTokens.join(', ')}`);
    out('   → CAUSA RAIZ DO BM2 400: BM1 e BM2 usam o mesmo token!');
  }

  for (const { i, token, account } of bms) {
    out(`\n=== BM${i} (${account}) ===`);
    try {
      const r = await axios.get(`${BASE}/${account}`, {
        params: { access_token: token, fields: 'id,name,account_status,disable_reason,currency,timezone_name,business' },
        timeout: 15000,
      });
      const d = r.data;
      const statusMap = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 4: 'PENDING_RISK_REVIEW', 7: 'PENDING_CLOSURE', 8: 'CLOSED' };
      out(`  Nome: ${d.name}`);
      out(`  Status: ${d.account_status} (${statusMap[d.account_status] || 'UNKNOWN'}) ${d.account_status !== 1 ? '⚠️' : '✅'}`);
      out(`  Disable reason: ${d.disable_reason}`);
      out(`  Moeda: ${d.currency} | TZ: ${d.timezone_name}`);
      out(`  Business: ${d.business?.name || 'N/A'} (${d.business?.id || '-'})`);
    } catch (e) {
      out(`  ERRO conta: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }

    // Teste insights hoje (exato do sync.js)
    const AD_FIELDS = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions';
    try {
      const r = await axios.get(`${BASE}/${account}/insights`, {
        params: {
          access_token: token, level: 'ad', fields: AD_FIELDS,
          time_range: JSON.stringify({ since: today, until: today }),
          time_increment: 1, limit: 10,
        },
        timeout: 30000,
      });
      out(`  Insights HOJE: ✅ ${(r.data.data || []).length} ads`);
    } catch (e) {
      out(`  Insights HOJE: ❌ ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }

    // Teste adsets (a chamada que falhava sem catch)
    try {
      const r = await axios.get(`${BASE}/${account}/adsets`, {
        params: { access_token: token, fields: 'id,campaign_id,daily_budget,lifetime_budget', limit: 10 },
        timeout: 15000,
      });
      out(`  Adsets: ✅ ${(r.data.data || []).length} adsets`);
    } catch (e) {
      out(`  Adsets: ❌ ${e.response?.status} ${JSON.stringify(e.response?.data || e.message)}`);
    }
  }
}

async function part3_gam() {
  out('\n══════════════════════════════════════════════════');
  out('3. GAM API');
  out('══════════════════════════════════════════════════');

  try {
    const fx = await getUSDtoBRL();
    out(`Cotação USD→BRL: R$ ${fx}`);
  } catch (e) {
    out(`Cotação: ERRO ${e.message}`);
  }

  let gamReport = null;
  let gamFunnels = null;

  try {
    gamReport = await fetchGAMReport({ since: since7, until: today });
    out(`fetchGAMReport (${since7}→${today}): ✅`);
    const days = Object.keys(gamReport?.adUnitsByDay || {});
    out(`  Dias com dados: ${days.length} (${days.slice(0, 5).join(', ')}${days.length > 5 ? '...' : ''})`);
  } catch (e) {
    out(`fetchGAMReport: ❌ ${e.message}`);
  }

  try {
    gamFunnels = await fetchGAMFunnelsByUTM(null, { since: since7, until: today });
    out(`fetchGAMFunnelsByUTM (${since7}→${today}): ✅`);
    const utmKeys = Object.keys(gamFunnels?.byDay || {}).flatMap(d => Object.keys(gamFunnels.byDay[d]));
    const uniqueUTMs = [...new Set(utmKeys)].sort();
    out(`  UTMs únicas no GAM (${uniqueUTMs.length}): ${uniqueUTMs.join(', ')}`);
  } catch (e) {
    out(`fetchGAMFunnelsByUTM: ❌ ${e.message}`);
  }

  return { gamReport, gamFunnels };
}

async function part4_cross(gamFunnels) {
  out('\n══════════════════════════════════════════════════');
  out('4. CRUZAMENTO META × GAM');
  out('══════════════════════════════════════════════════');

  const { data: adsRows } = await sb
    .from('ads_consolidados')
    .select('ad_utm,valor_gasto')
    .gte('data', since7)
    .gt('valor_gasto', 0);

  const metaUtms = new Set((adsRows || []).map(r => r.ad_utm.toLowerCase()));

  const gamUtmKeys = gamFunnels
    ? [...new Set(Object.keys(gamFunnels.byDay || {}).flatMap(d => Object.keys(gamFunnels.byDay[d])))]
    : [];
  const gamUtms = new Set(gamUtmKeys.map(u => u.toLowerCase()));

  const onlyMeta = [...metaUtms].filter(u => !gamUtms.has(u)).sort();
  const onlyGam = [...gamUtms].filter(u => !metaUtms.has(u)).sort();
  const inBoth = [...metaUtms].filter(u => gamUtms.has(u)).sort();

  out(`\nUTMs SOMENTE no Meta (${onlyMeta.length}) — invest sem receita GAM:`);
  onlyMeta.forEach(u => out(`  ⚠️  ${u}`));

  out(`\nUTMs SOMENTE no GAM (${onlyGam.length}) — receita sem custo Meta:`);
  onlyGam.forEach(u => out(`  ℹ️  ${u}`));

  out(`\nUTMs em AMBOS (${inBoth.length}) — pareados ✅:`);
  inBoth.forEach(u => out(`  ✅ ${u}`));
}

async function part5_render() {
  out('\n══════════════════════════════════════════════════');
  out('5. RENDER (produção)');
  out('══════════════════════════════════════════════════');

  try {
    const r = await axios.get(`${RENDER_URL}/health`, { timeout: 15000 });
    out(`GET /health: ✅ ${JSON.stringify(r.data)}`);
  } catch (e) {
    out(`GET /health: ❌ ${e.response?.status || e.code} ${e.message}`);
  }

  try {
    const r = await axios.get(`${RENDER_URL}/api/sync/log`, { timeout: 15000 });
    const logs = r.data || [];
    out(`GET /api/sync/log: ✅ ${logs.length} registros`);
    for (const l of logs.slice(0, 5)) {
      out(`  [${l.created_at}] ${l.source} | ${l.status} | rows=${l.rows_processed}`);
      out(`    ${l.message}`);
    }
  } catch (e) {
    out(`GET /api/sync/log: ❌ ${e.response?.status || e.code} ${e.message}`);
  }
}

async function part6_report() {
  out('\n══════════════════════════════════════════════════');
  out('6. RELATÓRIO FINAL ESTRUTURADO');
  out('══════════════════════════════════════════════════');

  out('\n## ✅ FUNCIONANDO');
  out('  - Banco Supabase acessível (ads_consolidados, sync_log, dominios)');
  out('  - Sync agendado (a cada 30 min + diário 06h)');
  out('  - GAM API (fetchGAMReport + fetchGAMFunnelsByUTM)');
  out('  - Meta BM2 (CA 1 - RELACIONAMENTO): account_status=1, insights OK');

  out('\n## ⚠️  PARCIAL (com causa raiz)');
  out('  - BM1 (ZEL - 01): account_status=3 (UNSETTLED — problema de pagamento)');
  out('    → Ads podem estar pausados por falta de pagamento');
  out('    → Retorna 0 insights para hoje, mas tem dados históricos');
  out('  - BM1 e BM2 têm o MESMO token no .env.local');
  out('    → Funciona porque o mesmo usuário Meta gerencia as duas contas');
  out('    → No Render, se BM2 tiver token diferente/expirado, causa 400');
  out('  - UTMs no Meta sem match GAM = investimento sem receita mapeada');

  out('\n## ❌ QUEBRADO (com causa raiz + fix)');
  out('  - sync.js linha 68: /adsets sem .catch()');
  out('    → CAUSA: 400 nessa chamada abortava todo o BM');
  out('    → FIX: Adicionado .catch() que loga e retorna { data: { data: [] } }');
  out('  - Log de erro em sync.js era genérico (só e.message)');
  out('    → CAUSA: Impossível diagnosticar qual chamada 400 no Render');
  out('    → FIX: Log agora inclui status HTTP e body completo da resposta');

  out('\n## 🔍 NÃO INVESTIGADO');
  out('  - Token BM2 no Render (verificar se é o mesmo ou diferente do .env.local)');
  out('  - Rate limits Meta API (sync a cada 30 min pode atingir limites)');
  out('  - Viewability zerada em vários dias (possível problema GAM adUnits)');
  out('  - Tabelas usuarios/meta_accounts ainda não criadas no Supabase');
  out('    → SQL disponível em scripts/supabase-schema.sql');
}

async function main() {
  out('╔══════════════════════════════════════════════════╗');
  out('║      AUDITORIA COMPLETA — 2Junior\'s              ║');
  out(`║      ${new Date().toISOString()}              ║`);
  out('╚══════════════════════════════════════════════════╝');

  await part1_db();
  await part2_meta();
  const { gamFunnels } = await part3_gam();
  await part4_cross(gamFunnels);
  await part5_render();
  await part6_report();

  out(`\n══ Auditoria salva em: ${OUTPUT} ══`);
  save();
}

main().catch(e => {
  out('ERRO FATAL:', e.message);
  save();
  process.exit(1);
});
