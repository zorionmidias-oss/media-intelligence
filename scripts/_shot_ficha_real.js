'use strict';
// Print da ficha COMPLETA (desenho SVG + métricas) com DADOS REAIS. conjunto/campanha/geral. dark.
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium }=require('playwright');
const ROOT=path.join(__dirname,'..','public');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.map':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/dashboard.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(p)]||'application/octet-stream');res.end(d);});});
const OUT=path.join(__dirname,'..','_shots');
const L=f=>JSON.parse(fs.readFileSync(path.join(OUT,f),'utf8'));
const conj=L('real-conjunto1.json'),camp=L('real-campanha1.json'),geral=L('real-geral.json'),cardD=L('real-card.json');

(async()=>{
  await new Promise(r=>server.listen(8129,r));
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width:1480,height:900}});
  await page.goto('http://localhost:8129/dashboard.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(1200);
  const shot=async(d,tipo,file)=>{
    await page.evaluate(({d,tipo,cardD})=>{
      document.documentElement.setAttribute('data-theme','dark');
      const ov=document.getElementById('loading-overlay');if(ov)ov.remove();
      S.dgcCfg=d.cfg||{};
      // desativa o fixed/overflow do modal p/ fullPage capturar tudo
      const m=document.getElementById('modal-diag');
      m.style.position='static';m.style.display='block';m.style.height='auto';
      const bd=document.getElementById('modal-diag-body');bd.style.overflow='visible';bd.style.height='auto';
      // esconde o resto da página
      document.querySelectorAll('body > *:not(#modal-diag)').forEach(el=>el.style.display='none');
      bd.innerHTML=fichaHTML(d,tipo);
      // injeta card-a-card real
      const box=document.getElementById('ficha-card');
      if(box){let botoes=(cardD.botoes||[]).filter(b=>b.botao);if(botoes.length){const porPag={};botoes.forEach(b=>porPag[b.pagina]=(porPag[b.pagina]||0)+Number(b.impressoes||0));const pagTop=Object.entries(porPag).sort((a,b)=>b[1]-a[1])[0][0];const nBt=s=>{const mm=String(s).match(/(\d+)/);return mm?+mm[1]:999;};const seq=botoes.filter(b=>b.pagina===pagTop).sort((a,b)=>nBt(a.botao)-nBt(b.botao));const max=Math.max(1,...seq.map(b=>+b.impressoes||0));let prev=null,rows='';seq.forEach(b=>{const imp=+b.impressoes||0;const ret=prev?imp/prev:1;const drop=prev&&ret<0.75;rows+=`<div class="crow ${drop?'drop':''}"><span class="cn">${b.botao}</span><div class="tr"><div class="fl" style="width:${Math.round(imp/max*100)}%"></div></div><span class="rt">${prev?(ret*100).toFixed(0)+'%':imp.toLocaleString('pt-BR')}</span></div>`;prev=imp;});box.innerHTML=`<div style="font-size:.62rem;color:var(--muted-light);margin-bottom:.4rem">página ${pagTop} · ${seq.length} botões</div>`+rows;}else box.innerHTML='<p style="font-size:.72rem;color:var(--muted);margin:0">Sem fluxo do bot.</p>';}
    },{d,tipo,cardD});
    await page.waitForTimeout(500);
    await page.screenshot({path:path.join(OUT,file),fullPage:true});
    console.log('saved',file);
  };
  await shot(conj,'conjunto','ficha3-conjunto.png');
  await shot(camp,'campanha','ficha3-campanha.png');
  await browser.close();server.close();process.exit(0);
})().catch(e=>{console.error(e.stack||e);process.exit(1);});
