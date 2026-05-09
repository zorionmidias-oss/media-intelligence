'use strict';
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function q(label, sql) {
  const { data, error } = await sb.rpc('execute_sql', { query: sql }).catch(() => ({ data: null, error: { message: 'rpc not available' } }));
  if (error && error.message.includes('rpc')) {
    console.log(`\n[${label}] (rpc unavailable — using JS queries)`);
    return null;
  }
  console.log(`\n══ ${label} ══`);
  if (error) { console.error('ERROR:', error.message); return null; }
  console.table(data);
  return data;
}

async function main() {
  console.log('\n═══════════════════════════════════════');
  console.log('PASSO 1 — INVENTÁRIO DO BANCO');
  console.log('═══════════════════════════════════════');

  // 1.1 Counts
  console.log('\n── 1.1 Estado das tabelas ──');
  const [
    { count: dominios },
    { count: ads_total },
    { count: ads_7d },
    { count: blocos_7d },
    { count: pendentes },
    { count: syncs_24h },
  ] = await Promise.all([
    sb.from('dominios').select('*', { count: 'exact', head: true }),
    sb.from('ads_consolidados').select('*', { count: 'exact', head: true }),
    sb.from('ads_consolidados').select('*', { count: 'exact', head: true }).gte('data', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
    sb.from('blocos_anuncio').select('*', { count: 'exact', head: true }).gte('data', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)),
    sb.from('dominios_pendentes').select('*', { count: 'exact', head: true }).eq('resolvido', false),
    sb.from('sync_log').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 86400000).toISOString()),
  ]);
  console.log({ dominios, ads_total, ads_7d, blocos_7d, pendentes, syncs_24h });

  // 1.2 Campos vazios por dia (últimos 7 dias)
  console.log('\n── 1.2 Campos vazios por dia ──');
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: adsAll, error: adsErr } = await sb
    .from('ads_consolidados')
    .select('data,valor_gasto,cpc,ctr,faturamento_bruto,impressoes_gam,viewability,orcamento_total,resultado')
    .gte('data', since7)
    .order('data', { ascending: false });

  if (adsErr) { console.error('ERROR:', adsErr.message); }
  else {
    const byDay = {};
    for (const r of adsAll) {
      const d = r.data;
      if (!byDay[d]) byDay[d] = { data: d, total_linhas: 0, spend_zero: 0, cpc_zero: 0, ctr_zero: 0, fat_zero: 0, imp_gam_zero: 0, view_zero: 0, orcamento_zero: 0, resultado_zero: 0 };
      const g = byDay[d];
      g.total_linhas++;
      if (!+r.valor_gasto) g.spend_zero++;
      if (!+r.cpc) g.cpc_zero++;
      if (!+r.ctr) g.ctr_zero++;
      if (!+r.faturamento_bruto) g.fat_zero++;
      if (!+r.impressoes_gam) g.imp_gam_zero++;
      if (!+r.viewability) g.view_zero++;
      if (!+r.orcamento_total) g.orcamento_zero++;
      if (!+r.resultado) g.resultado_zero++;
    }
    console.table(Object.values(byDay).sort((a, b) => b.data.localeCompare(a.data)));
  }

  // 1.3 Por tipo
  console.log('\n── 1.3 Estado por tipo (bot vs direto) ──');
  const { data: tipoData } = await sb
    .from('ads_consolidados')
    .select('tipo,valor_gasto,faturamento_bruto')
    .gte('data', since7);
  if (tipoData) {
    const tipos = {};
    for (const r of tipoData) {
      const t = r.tipo || 'null';
      if (!tipos[t]) tipos[t] = { tipo: t, linhas: 0, total_spend: 0, total_fat: 0 };
      tipos[t].linhas++;
      tipos[t].total_spend += +r.valor_gasto || 0;
      tipos[t].total_fat += +r.faturamento_bruto || 0;
    }
    for (const t of Object.values(tipos)) {
      t.roas_medio = t.total_spend > 0 ? (t.total_fat / t.total_spend).toFixed(4) : '0';
      t.total_spend = t.total_spend.toFixed(2);
      t.total_fat = t.total_fat.toFixed(2);
    }
    console.table(Object.values(tipos));
  }

  // 1.4 Sync log (últimos 10)
  console.log('\n── 1.4 Últimos 10 sync_log ──');
  const { data: logs } = await sb
    .from('sync_log')
    .select('created_at,source,status,rows_processed,duration_ms,message')
    .order('created_at', { ascending: false })
    .limit(10);
  if (logs) {
    for (const l of logs) {
      console.log(`[${l.created_at}] ${l.source} | ${l.status} | rows=${l.rows_processed} | ${l.duration_ms}ms`);
      console.log(`  msg: ${l.message}`);
    }
  }

  // PASSO 2 — Meta × GAM cross
  console.log('\n\n═══════════════════════════════════════');
  console.log('PASSO 2 — CRUZAMENTO META × GAM');
  console.log('═══════════════════════════════════════');

  // 2.1 UTMs únicas com spend > 0
  console.log('\n── 2.1 UTMs únicas com spend > 0 (últimos 7d) ──');
  const { data: utms } = await sb
    .from('ads_consolidados')
    .select('ad_utm,tipo,dominio_id')
    .gte('data', since7)
    .gt('valor_gasto', 0)
    .order('ad_utm');
  const uniqueUtms = [...new Map((utms || []).map(u => [`${u.dominio_id}|${u.ad_utm}`, u])).values()];
  console.table(uniqueUtms);

  // 2.2 Por UTM: spend vs faturamento
  console.log('\n── 2.2 Spend vs Faturamento por UTM ──');
  const { data: allRows7 } = await sb
    .from('ads_consolidados')
    .select('ad_utm,tipo,valor_gasto,faturamento_bruto')
    .gte('data', since7)
    .gt('valor_gasto', 0);

  const utmMap = {};
  for (const r of allRows7 || []) {
    const k = r.ad_utm;
    if (!utmMap[k]) utmMap[k] = { ad_utm: k, tipo: r.tipo, gastou: 0, faturou: 0 };
    utmMap[k].gastou += +r.valor_gasto || 0;
    utmMap[k].faturou += +r.faturamento_bruto || 0;
  }
  const utmList = Object.values(utmMap).map(u => ({
    ...u,
    gastou: +u.gastou.toFixed(2),
    faturou: +u.faturou.toFixed(2),
    status: u.faturou === 0 ? '❌ SEM MATCH GAM' : '✅ OK',
  })).sort((a, b) => b.gastou - a.gastou);
  console.table(utmList);

  // PASSO 4 — Validar frontend (just list what we know from file reads)
  console.log('\n\n═══════════════════════════════════════');
  console.log('PASSO 4 — ROTAS DO SERVIDOR');
  console.log('═══════════════════════════════════════');
  const routes = [
    { method: 'GET', route: '/api/overview', source: 'BANCO (ads_consolidados + blocos_anuncio)', notes: 'Principal rota do dashboard' },
    { method: 'GET', route: '/api/dashboard', source: 'BANCO (ads_consolidados)', notes: 'Tabela Campanhas — agrega por UTM' },
    { method: 'GET', route: '/api/reports-gam', source: 'BANCO (blocos_anuncio + ads_consolidados)', notes: 'Tab GAM — viewability vem de ads_consolidados' },
    { method: 'GET', route: '/api/metrics', source: 'API EXTERNA (Meta live)', notes: 'LEGACY — não usado pelo novo frontend' },
    { method: 'POST', route: '/api/insights', source: 'API EXTERNA (Meta + Anthropic)', notes: 'Análise IA' },
    { method: 'GET', route: '/api/dominios', source: 'BANCO (dominios)', notes: '' },
    { method: 'POST', route: '/api/dominios', source: 'BANCO (dominios)', notes: '' },
    { method: 'GET', route: '/api/dominios/pendentes', source: 'BANCO (dominios_pendentes)', notes: '' },
    { method: 'POST', route: '/api/dominios/aprovar', source: 'BANCO (dominios + dominios_pendentes)', notes: '' },
    { method: 'POST', route: '/api/sync/forcar', source: 'API EXTERNA (Meta + GAM) → BANCO', notes: '' },
    { method: 'GET', route: '/api/sync/log', source: 'BANCO (sync_log)', notes: '' },
  ];
  console.table(routes);

  console.log('\n── fetch() calls em public/index.html ──');
  const fetches = [
    'fetch(/api/overview)   → loadData() — carrega KPIs, trend, funnels, campanhas',
    'fetch(/api/reports-gam) → loadGAMReport() — tab Reports GAM',
    'fetch(/api/dashboard)  → loadCampaignsDB() — tab Campanhas',
    'fetch(/api/dominios)   → loadDominios() + initDomainFilter()',
    'fetch(/api/dominios/pendentes) → loadDominios() + checkPending()',
    'fetch(/api/sync/log)   → updateSyncBadge()',
    'fetch(/api/insights)   → checkAI(), sendAI(), autoInsights()',
    'fetch(/api/dominios POST) → submitAddDomain()',
    'fetch(/api/dominios/aprovar) → submitAprovarDomain()',
  ];
  fetches.forEach(f => console.log(' •', f));

  console.log('\n── Inconsistências frontend ──');
  const issues = [
    'PROBLEMA: /api/reports-gam busca blocos_anuncio sem coluna "data" no select → falta "data" no select da rota reports-gam.js:18',
    'PROBLEMA: loadData() passa forceRefresh=1 mas /api/overview ignora esse parâmetro — não dispara sync',
    'PROBLEMA: renderNetworks() é chamado com d.networks=[]. O dropdown "f-domain" é populado via loadDominios() mas só quando vai na tab Domínios',
    'BUG: initDomainFilter() não existe — loadDominios() popula f-domain, mas só quando tab=domains é aberta',
    'INFO: /api/overview retorna cpc:0 hardcoded na linha 192 do route',
  ];
  issues.forEach(i => console.log(' •', i));
}

main().catch(e => { console.error('ERRO FATAL:', e.message, e.stack); process.exit(1); });
