// Screenshot da Overview com respostas-mock (forma exata das APIs), SEM login.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
mkdirSync('frontend/_shots', { recursive: true });

const trend = [];
for (let d = 16; d <= 29; d++) {
  const fat = 8000 + (d - 16) * 1050 + (d % 3) * 400;
  const inv = 6000 + (d - 16) * 230;
  trend.push({ date: `2026-08-${d}`, faturamento: fat, investimento: inv, lucro: fat - inv, ecpm: 15 + (d % 4), roas: +(fat / inv).toFixed(3) });
}
const overview = {
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
const mkHours = (n, scale) => Array.from({ length: n }, (_, h) => ({
  hora: h, receita: Math.round(200 + Math.sin(h / 3) * 120 * scale + h * 12 * scale), investimento: Math.round(150 + h * 8 * scale),
  ecpm: +(14 + Math.sin(h / 4) * 4).toFixed(2), roi: +(30 + Math.sin(h / 5) * 40).toFixed(1), impressoes: Math.round(9000 + h * 800 * scale),
  sessoes: Math.round(300 + h * 30 * scale), resultado: Math.round(8 + h), conversas: Math.round(3 + h * 0.6), custo_resultado: +(20 + Math.sin(h) * 5).toFixed(2), par: +(28 + Math.sin(h / 2) * 6).toFixed(2),
}));
const intraday = { hoje: mkHours(15, 1.06), ontem: mkHours(24, 1), hora_atual: 14, data_hoje: '2026-08-31', data_ontem: '2026-08-30', sem_dados: false };
const dominios = [{ id: 1, nome: 'sitesa.co.za' }, { id: 2, nome: 'sitenaija.ng' }, { id: 3, nome: 'kenyanews.ke' }];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
await page.route('**/api/overview*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) }));
await page.route('**/api/intraday*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(intraday) }));
await page.route('**/api/dominios*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dominios) }));
await page.goto('http://localhost:5174/', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
for (const mode of ['dark', 'light']) {
  await page.evaluate((m) => document.documentElement.setAttribute('data-mode', m), mode);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `frontend/_shots/overview-${mode}.png`, fullPage: true });
}
console.log('overview shots salvos');
await browser.close();
