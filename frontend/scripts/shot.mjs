// Screenshot claro + escuro de uma rota do app React.
// Reaproveita o Playwright da raiz do projeto (resolução sobe para ../node_modules).
// Uso: node frontend/scripts/shot.mjs "http://localhost:5173/" nome
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:5173/';
const name = process.argv[3] || 'shot';
mkdirSync('frontend/_shots', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
await page.goto(url, { waitUntil: 'networkidle' });
for (const mode of ['dark', 'light']) {
  await page.evaluate((m) => document.documentElement.setAttribute('data-mode', m), mode);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `frontend/_shots/${name}-${mode}.png`, fullPage: true });
}
await browser.close();
console.log(`shots salvos: frontend/_shots/${name}-{dark,light}.png`);
