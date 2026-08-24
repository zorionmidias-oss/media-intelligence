'use strict';
// Espera o próximo sync da PRODUÇÃO e confere se o parser novo pegou.
const { google } = require('googleapis');
const supabase = require('../src/lib/supabase');
const ID = '1HIx10S1kGmjsposvvpdM1OMdclbm3t0Z92ERz_QzF0A';
const CORTE = process.argv[2];   // ISO: só considera sync depois disso
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const auth = new google.auth.GoogleAuth({ keyFile: './credentials/google-service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sh = google.sheets({ version: 'v4', auth });

  for (let i = 0; i < 40; i++) {                 // até ~40min
    const { data } = await supabase.from('sync_log')
      .select('created_at,status,message').order('created_at', { ascending: false }).limit(1);
    const ultimo = data && data[0];
    if (ultimo && ultimo.created_at > CORTE) {
      console.log(`\n>>> Produção sincronizou em ${String(ultimo.created_at).slice(11,19)} — ${ultimo.status}`);
      console.log(`    ${ultimo.message}`);
      await sleep(20000);   // dá tempo do sheetsGestao rodar depois do sync

      const r = await sh.spreadsheets.values.get({ spreadsheetId: ID, range: "'PAGINAS'!A1:K200" });
      const rows = r.data.values || [];
      const h = rows[0] || [];
      const iQtd = h.findIndex(x => /QTD/i.test(x || ''));
      const body = rows.slice(1).filter(x => (x[1] || '').trim());
      const comConj = body.filter(x => /[1-9]/.test(x[iQtd] || '')).length;

      const { data: ads } = await supabase.from('ads_consolidados')
        .select('pais_sigla').eq('data', new Date().toISOString().slice(0,10));
      const semPais = (ads || []).filter(a => !a.pais_sigla).length;

      console.log(`\n    PAGINAS: ${comConj} de ${body.length} páginas com conjunto ativo`);
      console.log(`    ads_consolidados hoje: ${(ads||[]).length} linhas, ${semPais} sem país`);
      console.log(comConj > 20 && semPais === 0
        ? '\n✅ DEPLOY OK — parser novo rodando em produção'
        : `\n⚠ AINDA ERRADO — esperado >20 páginas e 0 sem país`);
      return;
    }
    await sleep(60000);
  }
  console.log('⚠ nenhum sync da produção em 40min — verificar o deploy no Render');
})().catch(e => console.error('ERRO', e.message));
