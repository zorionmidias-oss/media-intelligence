// Teste do guard de GAM indisponível no syncAll.
// Uso:
//   node -r dotenv/config scripts/_test-sync-gam-fail.js          → run normal (GAM real)
//   node -r dotenv/config scripts/_test-sync-gam-fail.js --fail   → GAM forçado a falhar (preserve deve segurar a receita)
const failMode = process.argv.includes('--fail');

if (failMode) {
  // Patch ANTES de carregar sync.js — o destructuring lá pega as versões falhas
  const gam = require('../src/lib/gam');
  gam.fetchGAMReport = async () => { throw new Error('TESTE: GAM report fora do ar'); };
  gam.fetchGAMFunnelsByUTM = async () => ({ campaigns: [], sources: [] }); // como a falha real: sem byDay
}

const { syncAll } = require('../src/lib/sync');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function snapshot(label) {
  const out = {};
  for (const dia of ['2026-07-20', '2026-07-21']) {
    const { data } = await sb.from('ads_consolidados')
      .select('valor_gasto,faturamento_real,gam_match').eq('data', dia).limit(2000);
    const fat = (data || []).reduce((s, r) => s + (+r.faturamento_real || 0), 0);
    const gasto = (data || []).reduce((s, r) => s + (+r.valor_gasto || 0), 0);
    const matched = (data || []).filter(r => r.gam_match).length;
    out[dia] = { linhas: (data || []).length, gasto: +gasto.toFixed(2), fat: +fat.toFixed(2), matched };
  }
  console.log(`[${label}]`, JSON.stringify(out));
  return out;
}

(async () => {
  await snapshot('ANTES');
  console.log(`\n=== syncAll (${failMode ? 'GAM FORÇADO A FALHAR' : 'GAM real'}) ===\n`);
  const r = await syncAll();
  console.log('\nsyncAll retornou:', JSON.stringify({ success: r.success, rows: r.rowsProcessed, failedBMs: r.failedBMs }));
  await snapshot('DEPOIS');
  const { data: log } = await sb.from('sync_log').select('status,message').order('created_at', { ascending: false }).limit(1);
  console.log('último sync_log:', JSON.stringify(log[0]));
  process.exit(0);
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
