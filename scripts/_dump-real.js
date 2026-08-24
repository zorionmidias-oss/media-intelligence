'use strict';
// Dumpa respostas REAIS do handler /api/diagnostico p/ _shots/*.json (render com dados reais).
const fs = require('fs'); const path = require('path');
const handler = require('../src/app/api/diagnostico/route');
const UNTIL = process.argv[2] || '2026-08-22';
const OUT = path.join(__dirname, '..', '_shots'); fs.mkdirSync(OUT, { recursive: true });
function fakeRes(){return{_c:200,_j:null,status(c){this._c=c;return this;},json(o){this._j=o;return this;}};}
async function call(query){const r=fakeRes();await handler({query,allowedDominios:undefined},r);if(r._c!==200)throw new Error(JSON.stringify(r._j));return r._j;}
(async()=>{
  const g=await call({nivel:'geral',until:UNTIL});
  fs.writeFileSync(path.join(OUT,'real-geral.json'),JSON.stringify(g));
  const c=await call({nivel:'campanha',until:UNTIL});
  fs.writeFileSync(path.join(OUT,'real-camp.json'),JSON.stringify(c));
  // escolhe uma campanha ruim com volume + um conjunto dela
  const alvo=[...c.campanhas].filter(x=>x.campaign_id&&x.gasto>50).sort((a,b)=>a.roas-b.roas)[0]||c.campanhas[0];
  const cf=await call({nivel:'campanha',until:UNTIL,campaign_id:alvo.campaign_id});
  fs.writeFileSync(path.join(OUT,'real-campanha1.json'),JSON.stringify(cf));
  const conjAlvo=[...(cf.conjuntos||[])].sort((a,b)=>b.gasto-a.gasto)[0];
  let jf=null;
  if(conjAlvo){jf=await call({nivel:'conjunto',until:UNTIL,adset_id:conjAlvo.adset_id});fs.writeFileSync(path.join(OUT,'real-conjunto1.json'),JSON.stringify(jf));}
  console.log('geral ROAS',g.geral.roas,'| campanhas',c.campanhas.length);
  console.log('campanha alvo:',(alvo.campaign_name||'').slice(0,40),'ROAS',cf.campanha.roas,'| conjuntos',cf.conjuntos.length,'| gargalos',cf.gargalos.length);
  console.log('  funil:',cf.campanha.funil.map(n=>n.chave+'='+n.fator+'×').join(' '));
  if(jf)console.log('conjunto alvo:',jf.conjunto.adset_name,'ROAS',jf.conjunto.roas,'| gargalos',jf.gargalos.length,'| vazamento',JSON.stringify(jf.conjunto.vazamento));
})().catch(e=>{console.error('FALHOU:',e.message);process.exit(1);});
