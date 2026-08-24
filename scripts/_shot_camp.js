'use strict';
// Print da tabela Campanhas com as 6 colunas de diagnóstico (Frente 2), mock, dark+light.
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium }=require('playwright');
const ROOT=path.join(__dirname,'..','public');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.map':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/dashboard.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(p)]||'application/octet-stream');res.end(d);});});
const OUT=path.join(__dirname,'..','_shots');fs.mkdirSync(OUT,{recursive:true});

const fator=(chave,label,unidade,valor,mediana,fator,classe,piso_falha)=>({chave,label,unidade,valor,mediana,fator,delta:+(fator-1).toFixed(3),classe,piso:chave==='par'?3:null,piso_falha:!!piso_falha});
function diag(id,f,gchave,pot){const fs=[
  fator('custo_lead','Custo por lead','brl',0.13,0.11,f[0],f[0]<0.75?'bad':f[0]<0.9?'amb':f[0]>=1?'ok':'neu'),
  fator('spl','Sessões por lead','num',2.4,2.6,f[1],f[1]<0.75?'bad':f[1]<0.9?'amb':f[1]>=1?'ok':'neu'),
  fator('par','PAR','num',f[2]<0.9?1.0:1.9,1.9,f[2],f[2]<0.75?'bad':f[2]<0.9?'amb':f[2]>=1?'ok':'neu',f[2]<0.7),
  fator('ecpm','eCPM','brl',70,75,f[3],f[3]<0.75?'bad':f[3]<0.9?'amb':f[3]>=1?'ok':'neu'),
];const g=fs.find(x=>x.chave===gchave);return{campaign_id:id,fatores:fs,gargalo:g?{chave:g.chave,label:g.label,fator:g.fator,delta:g.delta,classe:g.classe,piso_falha:g.piso_falha}:null,potencial:{corrigido:pot}};}

const CAMPS=[
  {campaign_id:'c1',f:[0.58,0.90,1.05,0.95],g:'custo_lead',pot:0.97,utm:'nokwandamkufb',roas:0.565,inv:121.46,fat:68.6,pais:'ZA',pag:'mkuker',est:'E9'},
  {campaign_id:'c2',f:[0.95,0.79,0.92,1.02],g:'spl',pot:0.77,utm:'thandolulhefb',roas:0.605,inv:153.12,fat:92.6,pais:'ZA',pag:'mkuker',est:'E10'},
  {campaign_id:'c3',f:[0.98,0.95,0.54,0.98],g:'par',pot:0.97,utm:'siphesihlefb',roas:0.53,inv:110.0,fat:58.3,pais:'ZA',pag:'mkuker',est:'E12'},
  {campaign_id:'c4',f:[1.10,1.00,0.95,0.36],g:'ecpm',pot:1.90,utm:'frmenureceitafb',roas:0.683,inv:152.39,fat:104.0,pais:'BR',pag:'receitasmenu',est:'E10'},
  {campaign_id:'c5',f:[1.20,1.10,1.05,1.08],g:'par',pot:2.31,utm:'nolwazimsifb',roas:2.31,inv:268.0,fat:619.0,pais:'BR',pag:'receitasmenu',est:'E10'},
];
const ROWS=CAMPS.map(c=>({ad_utm:c.utm,campaign_id:c.campaign_id,dominio:c.pag+'.com',valor_gasto:c.inv,faturamento_real:c.fat,lucro:+(c.fat-c.inv).toFixed(2),roas:c.roas,cpc:0.02,custo_resultado:0.3,resultado:Math.round(c.inv*3),impressoes_gam:Math.round(c.fat*12),ecpm:70,rps:0.15,sessoes:Math.round(c.fat*10),par:1.5,sessao_por_conversa:1.3,breakeven:c.inv/c.fat,data_inicio:'2026-08-19',pais_sigla:c.pais,pagina:c.pag,estrutura:c.est,campanha_meta:`[${c.est}] [${c.pag.toUpperCase()}] [${c.pais}]`}));
const DIAG={};CAMPS.forEach(c=>DIAG[c.campaign_id]=diag(c.campaign_id,c.f,c.g,c.pot));

(async()=>{
  await new Promise(r=>server.listen(8125,r));
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width:2100,height:820}});
  await page.goto('http://localhost:8125/dashboard.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(1200);
  for(const theme of ['dark','light']){
    await page.evaluate(({rows,diag,t})=>{
      document.documentElement.setAttribute('data-theme',t);
      const ov=document.getElementById('loading-overlay');if(ov)ov.remove();
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('on'));
      document.getElementById('tab-campaigns').classList.add('on');
      S.diagByCamp=diag;S.campRows=rows;
      renderCampTable(rows);
      document.getElementById('tab-campaigns').scrollIntoView();
    },{rows:ROWS,diag:DIAG,t:theme});
    await page.waitForTimeout(400);
    const tbl=await page.$('#camp-table');
    await tbl.screenshot({path:path.join(OUT,`camp-${theme}.png`)});
    console.log('saved',`camp-${theme}.png`);
  }
  await browser.close();server.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
