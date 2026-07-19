'use strict';
// Auditoria visual: fotografa cada tela interna do dash (dark) p/ o plano de UX.
require('dotenv').config({ path: '.env.local' });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dashboardHandler = require('../src/app/api/dashboard/route');
const drilldownHandler = require('../src/app/api/drilldown/route');
const intradayHandler = require('../src/app/api/intraday/route');
const overviewHandler = require('../src/app/api/overview/route');
const reportsGamHandler = require('../src/app/api/reports-gam/route');
const funilBotoesHandler = require('../src/app/api/funil-botoes/route');
const { handler: notifHandler } = require('../src/app/api/notificacoes/route');

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
  const mk = h => h({ query, params: {}, fullUser: { role: 'admin' } }, mockRes(res));
  if (p === '/api/dashboard') return mk(dashboardHandler);
  if (p === '/api/intraday') return mk(intradayHandler);
  if (p === '/api/overview') return mk(overviewHandler);
  if (p === '/api/reports-gam') return mk(reportsGamHandler);
  if (p === '/api/funil-botoes') return mk(funilBotoesHandler);
  if (p === '/api/notificacoes') return mk(notifHandler);
  const mDrill = p.match(/^\/api\/drilldown\/(.+)$/);
  if (mDrill) return drilldownHandler({ params: { utm: decodeURIComponent(mDrill[1]) }, query }, mockRes(res));
  if (p === '/lib/chart.umd.min.js') {
    return fs.readFile(path.join(__dirname, '..', 'node_modules/chart.js/dist/chart.umd.min.js'), (err, data) => {
      if (err) { res.statusCode = 404; res.end('404'); return; }
      res.setHeader('Content-Type', 'text/javascript'); res.end(data);
    });
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

const TABS = ['analise-paises', 'gam', 'funil', 'relatorios', 'contas', 'diretorio', 'acessos', 'domains'];

(async () => {
  await new Promise(r => server.listen(8125, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const d = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await d.goto('http://localhost:8125/dashboard.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await d.waitForTimeout(2500);
  await d.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const ov = document.getElementById('loading-overlay'); if (ov) ov.remove();
  });
  for (const tab of TABS) {
    await d.evaluate((t) => {
      try { window.nav(t, document.querySelector(`button[onclick*="'${t}'"]`) || document.querySelector('.nav-btn')); } catch (e) {}
      const ov = document.getElementById('loading-overlay'); if (ov) ov.style.display = 'none';
    }, tab);
    await d.waitForTimeout(3500);
    await d.evaluate(() => { const ov = document.getElementById('loading-overlay'); if (ov) ov.style.display = 'none'; });
    await d.screenshot({ path: path.join(OUT, `audit-${tab}.png`) });
    console.log(`saved audit-${tab}.png`);
  }
  await d.close();
  await browser.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
