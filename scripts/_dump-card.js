'use strict';
// Dumpa o fluxo do bot REAL (GAM botões) p/ _shots/real-card.json.
const fs=require('fs'),path=require('path');
const { fetchGAMBotoesIndependente }=require('../src/lib/gam');
const SINCE=process.argv[2]||'2026-08-16', UNTIL=process.argv[3]||'2026-08-22';
const OUT=path.join(__dirname,'..','_shots');fs.mkdirSync(OUT,{recursive:true});
(async()=>{
  console.log('buscando botões GAM', SINCE,'→',UNTIL,'(pode levar ~30s)…');
  const d=await fetchGAMBotoesIndependente({since:SINCE,until:UNTIL});
  fs.writeFileSync(path.join(OUT,'real-card.json'),JSON.stringify(d));
  console.log('botões:',d.total_botoes,'| páginas:',d.paginas_disponiveis.join(','));
  const porPag={};(d.botoes||[]).forEach(b=>{porPag[b.pagina]=(porPag[b.pagina]||0)+Number(b.impressoes||0);});
  console.log('imp por página:',JSON.stringify(porPag));
  console.log('amostra top:',JSON.stringify((d.botoes||[]).slice(0,4).map(b=>({pb:b.pagina_botao,imp:b.impressoes}))));
})().catch(e=>{console.error('FALHOU:',e.message);process.exit(1);});
