'use strict';
// Auditoria geral: sync_log + volume de dados por dia nas tabelas core.
const supabase = require('../src/lib/supabase');
const { hojeBR, diasAtrasBR } = require('../src/lib/datas');

(async () => {
  const hoje = hojeBR(), d14 = diasAtrasBR(14);
  console.log('hoje(BR)=', hoje, ' janela desde', d14, ' agoraUTC=', new Date().toISOString());

  const { data: logs } = await supabase.from('sync_log')
    .select('*').order('created_at', { ascending: false }).limit(15);
  console.log('\n=== sync_log (15 últimos) ===');
  for (const l of logs || []) {
    const k = Object.keys(l).filter(x => !['id'].includes(x));
    console.log(JSON.stringify(Object.fromEntries(k.map(x => [x, l[x]]))));
  }

  const tabs = [
    ['ads_consolidados', 'data'],
    ['receita_ads', 'data'],
    ['blocos_anuncio', 'data'],
    ['dados_hora', 'data'],
  ];
  for (const [t, col] of tabs) {
    const { data, error } = await supabase.from(t).select(col).gte(col, d14).order(col, { ascending: false }).limit(50000);
    if (error) { console.log(`\n${t}: ERRO`, error.message); continue; }
    const cnt = {};
    for (const r of data) cnt[r[col]] = (cnt[r[col]] || 0) + 1;
    console.log(`\n=== ${t} — linhas/dia (últimos 14d) total=${data.length} ===`);
    Object.keys(cnt).sort().reverse().forEach(d => console.log('  ', d, cnt[d]));
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
