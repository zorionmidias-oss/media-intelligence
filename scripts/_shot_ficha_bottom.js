'use strict';
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium }=require('playwright');
const ROOT=path.join(__dirname,'..','public');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.map':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/dashboard.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(p)]||'application/octet-stream');res.end(d);});});
const OUT=path.join(__dirname,'..','_shots');
const camp=JSON.parse(fs.readFileSync(path.join(OUT,'real-campanha1.json'),'utf8'));
const cardD=JSON.parse(fs.readFileSync(path.join(OUT,'real-card.json'),'utf8'));
(async()=>{
  await new Promise(r=>server.listen(8130,r));
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1480,height:1000}});
  await page.goto('http://localhost:8130/dashboard.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(1200);
  await page.evaluate(({d,cardD})=>{
    document.documentElement.setAttribute('data-theme','dark');
    const ov=document.getElementById('loading-overlay');if(ov)ov.remove();
    S.dgcCfg=d.cfg||{};
    const m=document.getElementById('modal-diag');m.style.position='static';m.style.display='block';m.style.height='auto';
    const bd=document.getElementById('modal-diag-body');bd.style.overflow='visible';bd.style.height='auto';
    document.querySelectorAll('body > *:not(#modal-diag)').forEach(el=>el.style.display='none');
    bd.innerHTML=fichaHTML(d,'campanha');
    const box=document.getElementById('ficha-card');
    if(box){let bo=(cardD.botoes||[]).filter(b=>b.botao);const porPag={};bo.forEach(b=>porPag[b.pagina]=(porPag[b.pagina]||0)+ +b.impressoes);const pt=Object.entries(porPag).sort((a,b)=>b[1]-a[1])[0][0];const nb=s=>{const mm=String(s).match(/(\d+)/);return mm?+mm[1]:9;};const sq=bo.filter(b=>b.pagina===pt).sort((a,b)=>nb(a.botao)-nb(b.botao));const mx=Math.max(1,...sq.map(b=>+b.impressoes));let pv=null,r='';sq.forEach(b=>{const im=+b.impressoes;const rt=pv?im/pv:1;r+=`<div class="crow ${pv&&rt<.75?'drop':''}"><span class="cn">${b.botao}</span><div class="tr"><div class="fl" style="width:${Math.round(im/mx*100)}%"></div></div><span class="rt">${pv?(rt*100).toFixed(0)+'%':im}</span></div>`;pv=im;});box.innerHTML=r;}
    // scrolla até a linha do funil (nós)
    document.querySelector('.fnl').scrollIntoView();
  },{d:camp,cardD});
  await page.waitForTimeout(400);
  await page.screenshot({path:path.join(OUT,'ficha3-bottom.png')});
  console.log('saved ficha3-bottom.png');
  await browser.close();server.close();process.exit(0);
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
