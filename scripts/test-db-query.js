'use strict';
require('dotenv').config({ path: '.env.local' });
const supabase = require('../src/lib/supabase');

(async () => {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  // QUERY 1: ads_consolidados aggregation by day
  const { data: ads, error: adsErr } = await supabase
    .from('ads_consolidados')
    .select('data,valor_gasto,faturamento_bruto,impressoes_gam,viewability')
    .gte('data', since)
    .order('data', { ascending: false });

  if (adsErr) { console.error('ads_consolidados error:', adsErr.message); }

  // Group by day (replicating the SQL GROUP BY)
  const byDay = {};
  for (const r of ads || []) {
    if (!byDay[r.data]) byDay[r.data] = { data: r.data, total_rows: 0, total_meta: 0, total_gam: 0, imp_gam: 0, _vwSum: 0, _vwCount: 0 };
    const d = byDay[r.data];
    d.total_rows++;
    d.total_meta += Number(r.valor_gasto || 0);
    d.total_gam += Number(r.faturamento_bruto || 0);
    d.imp_gam += Number(r.impressoes_gam || 0);
    if (Number(r.viewability || 0) > 0) { d._vwSum += Number(r.viewability); d._vwCount++; }
  }

  console.log('\n══ QUERY 1: ads_consolidados últimos 7 dias ══');
  console.log('data        | rows | total_meta | total_gam | imp_gam    | media_view');
  console.log('------------|------|------------|-----------|------------|----------');
  for (const row of Object.values(byDay).sort((a, b) => b.data.localeCompare(a.data))) {
    const mv = row._vwCount > 0 ? (row._vwSum / row._vwCount).toFixed(2) : '0.00';
    console.log(
      `${row.data} | ${String(row.total_rows).padEnd(4)} | R$ ${row.total_meta.toFixed(2).padEnd(8)} | R$ ${row.total_gam.toFixed(2).padEnd(7)} | ${String(row.imp_gam).padEnd(10)} | ${mv}%`
    );
  }
  if (!Object.keys(byDay).length) console.log('(sem dados nos últimos 7 dias)');

  // Also show total rows in ads_consolidados
  const { count } = await supabase.from('ads_consolidados').select('*', { count: 'exact', head: true });
  console.log(`\nTotal rows in ads_consolidados: ${count}`);

  // Show distinct dates
  const { data: allDates } = await supabase.from('ads_consolidados').select('data').order('data', { ascending: false });
  const dates = [...new Set((allDates || []).map(r => r.data))];
  console.log('Datas com dados:', dates.join(', '));

  // QUERY 2: sync_log last 10
  const { data: logs, error: logErr } = await supabase
    .from('sync_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (logErr) { console.error('sync_log error:', logErr.message); }

  console.log('\n══ QUERY 2: sync_log últimos 10 registros ══');
  for (const l of logs || []) {
    const ts = new Date(l.created_at).toLocaleString('pt-BR');
    console.log(`[${ts}] ${l.status.toUpperCase()} | rows=${l.rows_processed} | ${l.duration_ms}ms | ${l.message}`);
  }
  if (!logs?.length) console.log('(nenhum log encontrado)');

  // QUERY 3: blocos_anuncio summary
  const { data: blocos, error: bErr } = await supabase
    .from('blocos_anuncio')
    .select('data,receita_total,impressoes')
    .gte('data', since)
    .order('data', { ascending: false });

  if (bErr) console.error('blocos_anuncio error:', bErr.message);

  const blocByDay = {};
  for (const r of blocos || []) {
    if (!blocByDay[r.data]) blocByDay[r.data] = { rows: 0, revenue: 0, impressions: 0 };
    blocByDay[r.data].rows++;
    blocByDay[r.data].revenue += Number(r.receita_total || 0);
    blocByDay[r.data].impressions += Number(r.impressoes || 0);
  }
  console.log('\n══ QUERY 3: blocos_anuncio últimos 7 dias ══');
  console.log('data        | rows | receita_total | impressoes');
  for (const [d, v] of Object.entries(blocByDay).sort((a, b) => b[0].localeCompare(a[0]))) {
    console.log(`${d} | ${String(v.rows).padEnd(4)} | R$ ${v.revenue.toFixed(2).padEnd(11)} | ${v.impressions}`);
  }
  if (!Object.keys(blocByDay).length) console.log('(sem dados nos últimos 7 dias)');

  const { count: bCount } = await supabase.from('blocos_anuncio').select('*', { count: 'exact', head: true });
  console.log(`\nTotal rows in blocos_anuncio: ${bCount}`);
})();
