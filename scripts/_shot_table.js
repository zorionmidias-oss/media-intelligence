'use strict';
// Injeta uma tabela de exemplo (classes reais do app) p/ avaliar hierarquia visual.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/dashboard.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.statusCode = 404; res.end('404'); return; }
    res.setHeader('Content-Type', MIME[path.extname(path.join(ROOT,p))] || 'application/octet-stream'); res.end(data);
  });
});
const OUT = path.join(__dirname, '..', '_shots'); fs.mkdirSync(OUT, { recursive: true });

const TABLE = `
<div class="sec" style="padding:1.5rem">
  <div class="card" style="padding:0;overflow:hidden">
    <div class="search-bar"><input type="text" class="search-in" placeholder="Buscar campanha..."></div>
    <div class="tbl-wrap scroll" style="border:none;border-radius:0">
      <table><thead><tr>
        <th>Campanha</th><th class="r">Gasto</th><th class="r">Faturamento</th><th class="r">Lucro</th><th class="r">ROI</th><th class="r">eCPM</th><th>Status</th>
      </tr></thead><tbody>
        ${[
          ['BR_NEWS_PT_BOT_0142','R$ 1.842,30','R$ 3.120,55','R$ 1.278,25','+69,4%','R$ 4,82','ok'],
          ['US_FINANCE_EN_DIRETO_0091','R$ 920,00','R$ 1.044,10','R$ 124,10','+13,5%','R$ 6,11','ok'],
          ['MX_SALUD_ES_BOT_0233','R$ 2.410,75','R$ 2.180,40','-R$ 230,35','-9,6%','R$ 3,40','bad'],
          ['BR_RECEITAS_PT_BOT_0178','R$ 640,20','R$ 1.510,90','R$ 870,70','+136,0%','R$ 7,25','ok'],
          ['CO_NOTICIAS_ES_DIRETO_0055','R$ 1.115,00','R$ 1.190,30','R$ 75,30','+6,8%','R$ 2,98','warn'],
          ['BR_CURIOSIDADES_PT_BOT_0210','R$ 380,40','R$ 902,15','R$ 521,75','+137,2%','R$ 5,60','ok'],
        ].map(r=>`<tr><td class="td-av"><span class="t-av">${r[0].slice(0,2)}</span>${r[0]}</td><td class="mo">${r[1]}</td><td class="mo">${r[2]}</td><td class="mo ${r[3].includes('-')?'neg':'pos'}">${r[3]}</td><td class="mo ${r[4].includes('-')?'neg':'pos'}">${r[4]}</td><td class="mo">${r[5]}</td><td><span class="badge b-${r[6]}">${r[6]==='ok'?'Ativa':r[6]==='bad'?'Prejuízo':'Atenção'}</span></td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="tbl-foot"><span style="color:var(--muted);font-size:.8125rem">6 campanhas</span><span class="mo" style="font-weight:700">Lucro total: R$ 2.609,75</span></div>
  </div>
</div>`;

async function shot(page, file, theme){
  await page.evaluate(({t,html})=>{ document.documentElement.setAttribute('data-theme',t); const ov=document.getElementById('loading-overlay'); if(ov)ov.remove(); const c=document.querySelector('.content'); if(c)c.innerHTML=html; }, {t:theme,html:TABLE});
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT,file) });
  console.log('saved',file);
}
(async()=>{
  await new Promise(r=>server.listen(8124,r));
  const b=await chromium.launch({channel:'chrome'});
  const d=await b.newPage({viewport:{width:1440,height:760}});
  await d.goto('http://localhost:8124/dashboard.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await d.waitForTimeout(1200);
  await shot(d,'table-dark.png','dark');
  await shot(d,'table-light.png','light');
  await b.close(); server.close(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
