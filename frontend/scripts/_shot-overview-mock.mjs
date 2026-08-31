// Screenshot da Overview com resposta-mock (forma exata do /api/overview), SEM login.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('frontend/_shots', { recursive: true });

const trend = [];
for (let d = 16; d <= 29; d++) {
  const fat = 8000 + (d - 16) * 1050 + (d % 3) * 400;
  const inv = 6000 + (d - 16) * 230;
  trend.push({ date: `2026-08-${d}`, faturamento: fat, investimento: inv, lucro: fat - inv, ecpm: 15 + (d % 4), roas: +(fat / inv).toFixed(3) });
}
const mock = {
  kpis: { faturamento: 21350, faturamento_bruto: 23722, investimento: 12480, lucro: 8870, roi: 71.1, results: 340, impressions: 1284000, sessoes: 41200, par: 31.2, ctr: 1.84, ecpm: 16.62, rps: 0.518, viewability: 62.4, taxaProgramatica: 48.3, cpc: 0.42, cpaIdeal: 0.0166, delayHours: 2.4, usdToBrl: 5.42, roas: 1.71 },
  comparacao: { faturamento: 9.8, investimento: 6.2, lucro: 14.1, roi: 3.4, gamEcpm: 4.1, gamImpressions: 7.2, gamCtr: -1.2 },
  trend,
  previsao: { orcamento_total: 14200, gasto_atual: 9800, orcamento_restante: 4400, faturamento_real_previsto: 24100, lucro_previsto: 9900, roas_previsto: 1.7 },
  topCampaigns: [
    { ad_utm: 'khanyisafb', name: 'E1 · khanyisafb', domain: 'sitesa.co.za', spend: 3210, faturado: 6480, lucro: 3270, roas: 2.02, roi: 101.9 },
    { ad_utm: 'yetundefb', name: 'E2 · yetundefb', domain: 'sitenaija.ng', spend: 2740, faturado: 4120, lucro: 1380, roas: 1.50, roi: 50.4 },
    { ad_utm: 'amarafb', name: 'E1 · amarafb', domain: 'kenyanews.ke', spend: 1980, faturado: 2610, lucro: 630, roas: 1.32, roi: 31.8 },
    { ad_utm: 'kwamefb', name: 'E3 · kwamefb', domain: 'ghanabuzz.gh', spend: 1640, faturado: 1510, lucro: -130, roas: 0.92, roi: -7.9 },
    { ad_utm: 'thabofb', name: 'E1 · thabofb', domain: 'sitesa.co.za', spend: 1420, faturado: 2280, lucro: 860, roas: 1.61, roi: 60.6 },
  ],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
await page.route('**/api/overview*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock) }));
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
for (const mode of ['dark', 'light']) {
  await page.evaluate((m) => document.documentElement.setAttribute('data-mode', m), mode);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `frontend/_shots/overview-${mode}.png`, fullPage: true });
}
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
console.log('overview shots salvos');
await browser.close();
