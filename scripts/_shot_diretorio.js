'use strict';
// Shot temporário: tela Diretório com links mock.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2', '.map':'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/dashboard.html';
  const f = path.join(ROOT, p);
  fs.readFile(f, (err, data) => {
    if (err) { res.statusCode = 404; res.end('404'); return; }
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    res.end(data);
  });
});

const OUT = path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });

const LINKS = [
  { id:1, titulo:'Resultados Diários', url:'https://docs.google.com/spreadsheets/d/abc', categoria:'Planilha', descricao:'Atualizada toda manhã' },
  { id:2, titulo:'Controle de Gastos Meta', url:'https://docs.google.com/spreadsheets/d/def', categoria:'Planilha', descricao:'Por conta e moeda' },
  { id:3, titulo:'SOP de Otimização', url:'https://docs.google.com/document/d/ghi', categoria:'Documento', descricao:'Passo a passo do time' },
  { id:4, titulo:'Briefing de Criativos', url:'https://www.notion.so/briefing', categoria:'Documento', descricao:'' },
  { id:5, titulo:'Criativos Aprovados', url:'https://drive.google.com/drive/folders/jkl', categoria:'Pasta', descricao:'Vídeos e imagens prontos' },
  { id:6, titulo:'GAM Console', url:'https://admanager.google.com', categoria:'Link', descricao:'Relatórios de receita' },
  { id:7, titulo:'Gerenciador de Anúncios', url:'https://adsmanager.facebook.com', categoria:'Link', descricao:'' },
];

async function shot(page, file, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    const ov = document.getElementById('loading-overlay'); if (ov) ov.remove();
  }, theme);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  console.log('saved', file);
}

(async () => {
  await new Promise(r => server.listen(8125, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/diretorio')) return route.fulfill({ contentType:'application/json', body: JSON.stringify(LINKS) });
    return route.fulfill({ contentType:'application/json', body: '{}' });
  });

  await page.goto('http://localhost:8125/dashboard.html', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const ov=document.getElementById('loading-overlay'); if(ov)ov.remove();
    window.nav('diretorio', document.querySelector('.nav-btn[onclick*="diretorio"]'));
  });
  await page.waitForTimeout(800);

  await shot(page, 'diretorio-dark.png', 'dark');
  await shot(page, 'diretorio-light.png', 'light');

  await page.close();
  await browser.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
