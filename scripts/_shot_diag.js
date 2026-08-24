'use strict';
// Print da banda "Diagnóstico do dia" (Frente 1) com dados mock realistas (22/08), dark+light.
// Serve public/ estático e injeta renderDiagBand() direto (sem backend/auth).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'public');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.map':'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/dashboard.html';
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.statusCode = 404; res.end('404'); return; }
    res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream'); res.end(data);
  });
});
const OUT = path.join(__dirname, '..', '_shots'); fs.mkdirSync(OUT, { recursive: true });

const MOCK = {
  since:'2026-08-22', until:'2026-08-22',
  cfg:{ taxa_gam:0.10 },
  geral:{
    gasto:1188.16, receita_liq:1199.09, roas:1.009, roas_ref:1.426, produto:0.708,
    fatores:[
      {chave:'custo_lead',label:'Custo por lead',unidade:'brl',valor:0.1318,mediana:0.1139,fator:0.864,delta:-0.136,classe:'amb',piso:null,piso_falha:false},
      {chave:'spl',label:'Sessões por lead',unidade:'num',valor:2.4054,mediana:3.0288,fator:0.794,delta:-0.206,classe:'amb',piso:null,piso_falha:false},
      {chave:'par',label:'PAR',unidade:'num',valor:0.9781,mediana:0.8754,fator:1.117,delta:0.117,classe:'ok',piso:3,piso_falha:true},
      {chave:'ecpm',label:'eCPM',unidade:'brl',valor:62.82,mediana:68.05,fator:0.923,delta:-0.077,classe:'neu',piso:null,piso_falha:false},
    ],
    gargalo:{chave:'spl',label:'Sessões por lead',fator:0.794,delta:-0.206,classe:'amb',piso_falha:false},
    potencial:{corrigido:1.271},
    validacao:{reconstruido:1.009,direto:1.009,divergencia:0.0004},
  },
  classificacao_gargalo:{chave:'spl',classe:'LOCAL',pct_conjuntos:0.27,pct_gasto:0.26},
  alertas_piso:[{chave:'par',label:'PAR',valor:0.9781,piso:3,classificacao:{chave:'par',classe:'LOCAL',pct_conjuntos:1.0,pct_gasto:1.0}}],
  distribuicao_veredito:{'aguardando volume':224,vivo:8,bom:8,'maturação':4,escalar:1},
  conjuntos_total:245,
};

(async () => {
  await new Promise(r => server.listen(8124, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://localhost:8124/dashboard.html', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(1200);

  for (const theme of ['dark','light']) {
    await page.evaluate(({ mock, t }) => {
      document.documentElement.setAttribute('data-theme', t);
      const ov = document.getElementById('loading-overlay'); if (ov) ov.remove();
      // garante aba overview visível
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('on'));
      const ovv=document.getElementById('tab-overview'); if(ovv)ovv.classList.add('on');
      renderDiagBand(mock, mock.since, mock.until);
      const sec=document.getElementById('diag-section'); if(sec)sec.style.display='';
      sec.scrollIntoView({block:'center'});
    }, { mock: MOCK, t: theme });
    await page.waitForTimeout(500);
    const sec = await page.$('#diag-section');
    await sec.screenshot({ path: path.join(OUT, `diag-${theme}.png`) });
    console.log('saved', `diag-${theme}.png`);
  }
  await browser.close(); server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
