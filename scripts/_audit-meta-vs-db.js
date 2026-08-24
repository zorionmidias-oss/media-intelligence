'use strict';
// Compara gasto REAL na Meta (por conta/dia) com o que está em ads_consolidados.
const axios = require('axios');
const supabase = require('../src/lib/supabase');
const { fetchAll } = require('../src/lib/fetchAll');
const { diasAtrasBR, hojeBR } = require('../src/lib/datas');
const BASE = 'https://graph.facebook.com/v19.0';

(async () => {
  const since = diasAtrasBR(12), until = hojeBR();
  const { data: accs } = await supabase.from('meta_accounts')
    .select('id,nome,ad_account_id,access_token,ativo,moeda,timezone_name').eq('ativo', true);

  const { data: db } = await fetchAll(() => supabase.from('ads_consolidados')
    .select('data,account_id,valor_gasto,valor_gasto_original').gte('data', since));
  const dbMap = {};
  for (const r of db) dbMap[`${r.account_id}|${r.data}`] = (dbMap[`${r.account_id}|${r.data}`] || 0) + Number(r.valor_gasto_original || 0);

  for (const a of accs) {
    console.log(`\n### ${a.nome} (${a.ad_account_id}) ${a.moeda} tz=${a.timezone_name}`);
    let rows = [];
    try {
      const r = await axios.get(`${BASE}/${a.ad_account_id}/insights`, {
        params: {
          access_token: a.access_token, level: 'account', fields: 'spend,impressions',
          time_range: JSON.stringify({ since, until }), time_increment: 1, limit: 100,
        }, timeout: 60000,
      });
      rows = r.data.data || [];
    } catch (e) {
      console.log('  ERRO Meta:', JSON.stringify(e.response?.data?.error || e.message));
      continue;
    }
    if (!rows.length) { console.log('  (sem gasto no período na Meta)'); }
    console.log('  data        spend(Meta,conta)  db(valor_gasto_original)  status');
    for (const r of rows) {
      const d = r.date_start, meta = Number(r.spend || 0), dbv = dbMap[`${a.ad_account_id}|${d}`] || 0;
      const diff = Math.abs(meta - dbv);
      const st = meta > 0 && dbv === 0 ? '❌ FALTANDO NO DB' : diff > Math.max(1, meta * 0.05) ? `⚠ divergente (${(dbv - meta).toFixed(2)})` : 'ok';
      console.log(`  ${d}  ${meta.toFixed(2).padStart(10)}  ${dbv.toFixed(2).padStart(14)}   ${st}`);
    }
    // contagem de anúncios ativos agora
    try {
      const r2 = await axios.get(`${BASE}/${a.ad_account_id}/ads`, {
        params: { access_token: a.access_token, fields: 'id', limit: 500, effective_status: JSON.stringify(['ACTIVE']) }, timeout: 60000,
      });
      console.log('  anúncios ACTIVE agora:', (r2.data.data || []).length);
    } catch (e) { console.log('  (falha ao contar ads ativos)', e.response?.data?.error?.message || e.message); }
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
