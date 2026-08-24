'use strict';
// Shot temporário: mostra o expand inline de "otimização rápida" com dados mock.
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

// ── Mock data ────────────────────────────────────────────────────────────────
const DASH = {
  kpis: { investimento: 63.79, faturamento: 81.4, lucro: 17.61, roas: 1.27, roi: 27.6,
          sessoes: 1422, conversas: 1902 },
  rows: [
    { ad_utm:'adamafb', dominio:'noticias-do-dia', pais_sigla:'BR', pais_nome:'Brasil',
      valor_gasto:63.79, faturamento_real:81.40, lucro:17.61, roas:1.276,
      cpc:0.04, custo_resultado:0.045, resultado:1422, impressoes_gam:48210, ecpm:1.69,
      rps:0.03, sessoes:1422, conversas:1902, sessao_por_conversa:0.75, breakeven:1.27,
      data_inicio:'2026-06-10' },
    { ad_utm:'zurifb', dominio:'portal-news', pais_sigla:'BR', pais_nome:'Brasil',
      valor_gasto:41.2, faturamento_real:38.9, lucro:-2.3, roas:0.944,
      cpc:0.05, custo_resultado:0.06, resultado:690, impressoes_gam:22100, ecpm:1.76,
      rps:0.028, sessoes:690, conversas:540, sessao_por_conversa:1.28, breakeven:2.14,
      data_inicio:'2026-06-12' },
  ],
};

const DRILL = {
  utm:'adamafb',
  total:{ spend:63.79, fat:81.4, lucro:17.61, roas:1.276, results:1422, rps:0.03 },
  adsets:[
    // sem receita por ad id (roi null) → fallback semáforo SPL vs BE (ruim) + conta USD no mínimo
    { adset_id:'1003', adset_name:'[ADAMA_BR_PT_BOT_0042] V3', status:'ACTIVE',
      campaign_name:'[NDD] [ADAMA_BR] V3', daily_budget:1.10, min_budget:1, moeda:'USD',
      spend:30.00, resultado_vc:300, conversas:300, faturamento_real:null, roi:null, ads:[] },
    // ROI ótimo (verde ≥1.2x)
    { adset_id:'1001', adset_name:'[ADAMA_BR_PT_BOT_0042] V1', status:'ACTIVE',
      campaign_name:'[NDD] [ADAMA_BR] V1', daily_budget:20.00, min_budget:5.26, moeda:'BRL',
      spend:23.79, resultado_vc:622, conversas:450, faturamento_real:32.10, roi:1.3493, ads:[] },
    // ROI ruim (vermelho <1.0x)
    { adset_id:'1002', adset_name:'[ADAMA_BR_PT_BOT_0042] V2', status:'ACTIVE',
      campaign_name:'[NDD] [ADAMA_BR] V2', daily_budget:15.00, min_budget:5.26, moeda:'BRL',
      spend:10.00, resultado_vc:500, conversas:200, faturamento_real:8.70, roi:0.87, ads:[] },
  ],
};

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
  await new Promise(r => server.listen(8124, r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    if (url.includes('/api/dashboard')) return route.fulfill({ contentType:'application/json', body: JSON.stringify(DASH) });
    if (url.includes('/api/drilldown')) return route.fulfill({ contentType:'application/json', body: JSON.stringify(DRILL) });
    return route.fulfill({ contentType:'application/json', body: '{}' });
  });

  await page.goto('http://localhost:8124/dashboard.html', { waitUntil: 'load' }).catch(()=>{});
  await page.waitForTimeout(3000);

  // garante datas preenchidas e navega para Campanhas
  await page.evaluate(() => {
    const s=document.getElementById('f-since'), u=document.getElementById('f-until');
    if(s)s.value='2026-06-10'; if(u)u.value='2026-06-17';
    const ov=document.getElementById('loading-overlay'); if(ov)ov.remove();
    window.nav('campaigns', document.querySelector('.nav-btn[onclick*="campaigns"]'));
  });
  await page.waitForTimeout(900);

  // expande a UTM adamafb
  await page.evaluate(() => {
    const btn=document.querySelector('#camp-db-body tr[data-utm="adamafb"] .utm-exp-btn');
    if(btn) btn.click();
  });
  await page.waitForTimeout(900);

  // abre o modo de edição de orçamento na 1ª linha (mostra ±20%)
  await page.evaluate(() => {
    const pencil=document.querySelector('.utm-detail-row .ud-bud .ud-bud-edit');
    if(pencil) pencil.click();
  });
  await page.waitForTimeout(400);

  await shot(page, 'optim-dark.png', 'dark');
  await shot(page, 'optim-light.png', 'light');

  await page.close();
  await browser.close();
  server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
