'use strict';
// Print da ficha de diagnóstico por conjunto (Frente 3), mock, dark+light.
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium }=require('playwright');
const ROOT=path.join(__dirname,'..','public');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.map':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/dashboard.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(p)]||'application/octet-stream');res.end(d);});});
const OUT=path.join(__dirname,'..','_shots');fs.mkdirSync(OUT,{recursive:true});

const F=(chave,label,unidade,valor,mediana,fator,classe,piso,piso_falha)=>({chave,label,unidade,valor,mediana,fator,delta:+(fator-1).toFixed(3),classe,piso:piso||null,piso_falha:!!piso_falha});
const conjunto={
  adset_id:'120248',adset_name:'noluthandombhelefb',campaign_name:'[E12] [MKUKER] [AFS] [ZA] · gancho E12',dominio_id:2,
  dias:3,gasto:54.65,receita_liq:25.89,leads:337,sessoes:365,imp_gam:369,results:365,
  roas:0.53,roas_ref:1.53,produto:0.346,
  fatores:[
    F('custo_lead','Custo por lead','brl',0.162,0.128,0.79,'amb'),
    F('spl','Sessões por lead','num',1.08,1.32,0.82,'amb'),
    F('par','PAR','num',1.01,1.86,0.54,'bad',3,true),
    F('ecpm','eCPM','brl',86.62,88.40,0.98,'neu'),
  ],
  gargalo:{chave:'par',label:'PAR',fator:0.54,delta:-0.46,classe:'bad',piso_falha:true},
  potencial:{corrigido:0.97,ate_piso:1.57},
  veredito:{classe:'kill',rotulo:'última chance · D4',texto:'ROAS 0,53x na faixa 0,20–0,60. Se não cruzar 0,60 até D4, mata.'},
  vazamento:{clicou:337,chegou:209,sessoes:365,taxa_chegada:0.62,perdidos:128,sess_por_chegada:1.75},
  validacao:{reconstruido:0.53,direto:0.53,divergencia:0.002},
};
const gargalos=[
  {chave:'par',label:'PAR',fator:0.54,delta:-0.46,classe:'bad',piso_falha:true,piso:3,valor:1.01,mediana:1.86,potencial:0.97,potencial_piso:1.57},
  {chave:'custo_lead',label:'Custo por lead',fator:0.79,delta:-0.21,classe:'amb',piso_falha:false,piso:null,valor:0.162,mediana:0.128,potencial:0.67,potencial_piso:null},
  {chave:'spl',label:'Sessões por lead',fator:0.82,delta:-0.18,classe:'amb',piso_falha:false,piso:null,valor:1.08,mediana:1.32,potencial:0.65,potencial_piso:null},
  {chave:'ecpm',label:'eCPM',fator:0.98,delta:-0.02,classe:'neu',piso_falha:false,piso:null,valor:86.62,mediana:88.4,potencial:0.54,potencial_piso:null},
];
const D={conjunto,gargalos,cfg:{taxa_gam:0.10,roi_maturacao:0.90,sistemico_pct:0.60}};
// lista p/ classificação: 8/10 com gargalo PAR, gasto concentrado
const LIST=[];for(let i=0;i<10;i++){const par=i<8;LIST.push({adset_id:'a'+i,gasto:par?60+i*5:20,gargalo:{chave:par?'par':(i===8?'spl':'custo_lead')}});}

(async()=>{
  await new Promise(r=>server.listen(8126,r));
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1500,height:1300}});
  await page.goto('http://localhost:8126/dashboard.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(1200);
  for(const theme of ['dark','light']){
    await page.evaluate(({d,list,t})=>{
      document.documentElement.setAttribute('data-theme',t);
      const ov=document.getElementById('loading-overlay');if(ov)ov.remove();
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('on'));
      document.getElementById('tab-diag-conjunto').classList.add('on');
      S.dgcList=list;S.dgcCfg=d.cfg;
      const sel=document.getElementById('dgc-select');
      sel.innerHTML=`<option value="${d.conjunto.adset_id}">${d.conjunto.adset_name} · ROAS 0,53x · última chance · D4</option>`;
      document.getElementById('dgc-count').textContent='10 conjuntos · 6 com veredito';
      document.getElementById('dgc-ficha').innerHTML=_dgcFichaHTML(d);
    },{d:D,list:LIST,t:theme});
    await page.waitForTimeout(400);
    const panel=await page.$('#tab-diag-conjunto .sec');
    await panel.screenshot({path:path.join(OUT,`ficha-${theme}.png`)});
    console.log('saved',`ficha-${theme}.png`);
  }
  await browser.close();server.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
