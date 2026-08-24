'use strict';
// Espera o próximo sync da PRODUÇÃO pós-deploy e confere se a receita GAM voltou.
const supabase = require('../src/lib/supabase');
const { hojeBR } = require('../src/lib/datas');
const CORTE = process.argv[2]; // ISO UTC: só considera sync depois disso
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const hoje = hojeBR();
  console.log('aguardando sync de produção depois de', CORTE);
  for (let i = 0; i < 60; i++) {
    const { data } = await supabase.from('sync_log')
      .select('created_at,status,message').order('created_at', { ascending: false }).limit(1);
    const u = data && data[0];
    if (u && u.created_at > CORTE) {
      console.log(`\n>>> SYNC ${u.created_at} — [${u.status}]`);
      console.log(`    ${u.message}`);

      const { data: rh } = await supabase.from('report_hora')
        .select('hora,receita').eq('data', hoje);
      const horas = [...new Set((rh || []).map(r => r.hora))].sort((a, b) => a - b);
      const { data: bl } = await supabase.from('blocos_anuncio')
        .select('receita_total,updated_at').eq('data', hoje);
      const bruto = (bl || []).reduce((s, r) => s + Number(r.receita_total || 0), 0);

      console.log(`    report_hora: última hora com dado = ${horas.length ? horas[horas.length - 1] : '—'} (antes: 13)`);
      console.log(`    blocos_anuncio hoje: R$${bruto.toFixed(2)} bruto (antes: R$760,41)`);
      console.log(u.status === 'success' ? '\n✅ GAM VOLTOU' : '\n⚠ ainda partial — ver mensagem acima');
      return;
    }
    await sleep(30000);
  }
  console.log('timeout: nenhum sync novo em 30min');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
