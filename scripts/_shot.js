'use strict';
// Script temporário: serve public/ e tira prints do "chrome" da UI (sem auth/dados).
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

async function shot(page, file, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.remove();
  }, theme);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  console.log('saved', file);
}

(async () => {
  await new Promise(r => server.listen(8123, r));
  const browser = await chromium.launch({ channel: 'chrome' });

  // Desktop
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto('http://localhost:8123/dashboard.html', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await d.waitForTimeout(1500);
  await shot(d, 'desktop-dark.png', 'dark');
  await shot(d, 'desktop-light.png', 'light');
  // telas com mais superfícies cinza (forms/inputs/tabelas) no tema claro
  for (const [tab, file] of [['relatorios','desktop-light-relatorios.png'],['contas','desktop-light-contas.png'],['gam','desktop-light-gam.png']]) {
    await d.evaluate((t) => { try { window.nav(t, document.querySelector('button[onclick*="\'' + t + '\'"]')); } catch(e){} }, tab);
    await d.waitForTimeout(900);
    await d.evaluate(() => document.documentElement.setAttribute('data-theme','light'));
    await d.screenshot({ path: path.join(OUT, file), fullPage: false });
    console.log('saved', file);
  }
  await d.close();

  // Mobile
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await m.goto('http://localhost:8123/mobile.html', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await m.waitForTimeout(1500);
  await shot(m, 'mobile-dark.png', 'dark');
  await m.close();

  await browser.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
