'use strict';
// Shot temporário: serve public/ + /api/dashboard e /api/drilldown REAIS (handlers
// chamados direto, sem auth) para verificar a aba Campanhas agrupada por campaign_id.
require('dotenv').config({ path: '.env.local' });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dashboardHandler = require('../src/app/api/dashboard/route');
const drilldownHandler = require('../src/app/api/drilldown/route');

const ROOT = path.join(__dirname, '..', 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };

function mockRes(res) {
  return {
    status(c) { res.statusCode = c; return this; },
    json(d) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(d)); },
  };
}

const server = http.createServer(async (req, res) => {
  const [p, qs] = req.url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  if (p === '/api/dashboard') {
    return dashboardHandler({ query, fullUser: { role: 'admin' } }, mockRes(res));
  }
  const mDrill = p.match(/^\/api\/drilldown\/(.+)$/);
  if (mDrill) {
    return drilldownHandler({ params: { utm: decodeURIComponent(mDrill[1]) }, query }, mockRes(res));
  }
  if (p.startsWith('/api/')) { res.statusCode = 404; res.end('{}'); return; }
  let f = p === '/' ? '/dashboard.html' : decodeURIComponent(p);
  fs.readFile(path.join(ROOT, f), (err, data) => {
    if (err) { res.statusCode = 404; res.end('404'); return; }
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    res.end(data);
  });
});

const OUT = path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  await new Promise(r => server.listen(8124, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const d = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  d.on('pageerror', e => console.log('PAGE_ERROR:', e.message));
  await d.addInitScript(() => localStorage.setItem('camp_col_prefs', JSON.stringify({rps:1,'sessao-conv':1,breakeven:1,inicio:1})));
  await d.goto('http://localhost:8124/dashboard.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await d.waitForTimeout(2500);
  // Overview dark + light
  await d.evaluate(()=>{document.documentElement.setAttribute('data-theme','dark');const ov=document.getElementById('loading-overlay');if(ov)ov.remove();});
  await d.waitForTimeout(2500);
  await d.screenshot({ path: path.join(OUT, 'redesign-overview-dark.png') });
  console.log('saved redesign-overview-dark.png');
  await d.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await d.waitForTimeout(700);
  await d.screenshot({ path: path.join(OUT, 'redesign-overview-light.png') });
  console.log('saved redesign-overview-light.png');
  await d.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
  await d.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const ov = document.getElementById('loading-overlay'); if (ov) ov.remove();
    document.getElementById('f-since').value = '2026-07-01';
    document.getElementById('f-until').value = '2026-07-18';
    try { window.nav('campaigns', document.querySelector('button[onclick*="\'campaigns\'"]')); } catch (e) {}
  });
  await d.waitForTimeout(4000);
  // Filtra khanyisafb para mostrar a separação por campanha
  await d.evaluate(() => { try { document.getElementById('search-camp-db').value=''; presetInicio(7); } catch (e) { console.log('filter err', e.message); } });
  await d.waitForTimeout(600);
  await d.screenshot({ path: path.join(OUT, 'campanhas-khanyisa-split.png'), fullPage: false });
  console.log('saved campanhas-khanyisa-split.png');
  // Expand do conjunto na linha com campaign_id
  await d.evaluate(() => {
    const btns = [...document.querySelectorAll('#camp-db-body .utm-exp-btn')];
    if (btns.length) btns[btns.length - 1].click(); // linha carimbada (com id)
  });
  await d.waitForTimeout(25000);
  await d.screenshot({ path: path.join(OUT, 'campanhas-khanyisa-expand.png'), fullPage: false });
  console.log('saved campanhas-khanyisa-expand.png');
  await d.close();
  await browser.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
