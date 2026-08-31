# Apple Liquid Glass — Fase 1 · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** Entregar, rodando localmente, o design system Apple Liquid Glass + as telas Overview, Campanhas e Países em React (`frontend/`), consumindo as APIs existentes, sem tocar no backend nem em produção.

**Architecture:** SPA React 19 + Vite + Tailwind v4 em `frontend/`. Backend Express e APIs `/api/*` inalterados. Design system baseado em tokens CSS (claro/escuro) + primitivos de vidro reutilizáveis. Dados vêm prontos das APIs de leitura (nenhum cálculo de negócio no front).

**Tech Stack:** React 19, Vite, Tailwind v4, Recharts (gráficos), react-day-picker (calendário), @fontsource/inter (tipografia), date-fns. Verificação: execução local + screenshots (Playwright/Chrome).

---

## Global Constraints

_(valores copiados verbatim do spec `docs/superpowers/specs/2026-08-30-apple-liquid-glass-redesign-design.md`; valem para TODAS as tarefas)_

- **Nada em produção.** Todo o trabalho na branch `redesign-liquid-glass`, **nunca** em `main` (auto-deploy no Render). Sem `git push` sem pedido explícito do usuário.
- **Sem mudança de API/dados/backend.** Nenhum arquivo em `src/`, `server.js`, sync, gam, parser, supabase é modificado. Os números vêm dos endpoints; nada de cálculo de receita/gasto/ROI/fuso no front.
- **Verificação = execução local + screenshot** comparado ao mockup aprovado (`.superpowers/brainstorm/1525-1788142640/content/overview-glass.html`) e aos tokens do spec. Sem framework de teste; funções puras verificadas com script node.
- **Acento:** `#0A84FF`. **Semânticos:** positivo `#30D158`, negativo `#FF453A`, alerta `#FF9F0A`.
- **Modo:** claro + escuro com toggle; **escuro é o padrão**; persiste em `localStorage['app-theme']` + respeita `prefers-color-scheme` quando não há preferência salva.
- **Tipografia:** Inter (400/500/600/700), números `tabular-nums`, `letter-spacing:-.02em`.
- **Vidro:** `backdrop-filter: blur(30px) saturate(180%)`, borda hairline 1px, cantos 20px, sombra suave + `inset 0 1px 0`; fallback sólido sem `backdrop-filter`; respeita `prefers-reduced-motion`.
- **Auth:** APIs protegidas por cookie JWT same-origin; chamadas com `credentials:'include'`; `401` → `window.location.href='/login.html'`.
- **"Hoje" = fuso São Paulo:** nunca `new Date().toISOString().slice(0,10)`. Datas de período vêm/são resolvidas via API; no front, formatação apenas.

---

## Estrutura de arquivos (Fase 1)

**Configuração / segurança**
- Modify: `package.json` (raiz) — restaurar dependências do backend.
- Modify: `frontend/package.json` — add recharts, react-day-picker, date-fns, @fontsource/inter.
- Modify: `frontend/vite.config.js` — proxy `/api` e `/login.html` → `http://localhost:3000` (cookies).
- Create: `frontend/scripts/shot.mjs` — screenshot Playwright (claro+escuro) de uma rota.

**Tema + tokens + dados**
- Create: `frontend/src/design-system/tokens.css` — variáveis CSS (claro/escuro).
- Create: `frontend/src/theme/ThemeProvider.jsx` — contexto de tema (escuro padrão, persistência).
- Modify: `frontend/src/hooks/useApi.js` — base relativa `/api`, `credentials:'include'`, 401→login.
- Create: `frontend/src/lib/format.js` — BRL, PCT, NUM, INT (tabular, pt-BR).

**Design system (primitivos)**
- Create: `frontend/src/design-system/GlassCard.jsx`
- Create: `frontend/src/design-system/KpiCard.jsx`
- Create: `frontend/src/design-system/GlassTable.jsx`
- Create: `frontend/src/design-system/Segment.jsx`
- Create: `frontend/src/design-system/ThemeToggle.jsx`
- Create: `frontend/src/design-system/Gauge.jsx`
- Create: `frontend/src/design-system/Chart.jsx` (AreaTrend + BarList via Recharts)
- Create: `frontend/src/design-system/DateRange.jsx` (react-day-picker)
- Create: `frontend/src/design-system/index.js` (barrel)
- Create: `frontend/src/design-system/_demo.jsx` (galeria de primitivos p/ screenshot)

**Layout**
- Create: `frontend/src/layouts/AppShell.jsx`
- Rewrite: `frontend/src/components/Sidebar.jsx`
- Create: `frontend/src/components/Topbar.jsx`

**Telas**
- Rewrite: `frontend/src/pages/Overview.jsx`
- Rewrite: `frontend/src/pages/Campaigns.jsx`
- Rewrite: `frontend/src/pages/Countries.jsx`

**App**
- Rewrite: `frontend/src/App.jsx`, `frontend/src/index.css`

---

## Fase 1A — Fundação & segurança

### Task 1: Restaurar `package.json` da raiz (backend não pode quebrar)

**Files:**
- Modify: `package.json` (raiz)

**Interfaces:**
- Produces: raiz com todas as deps do backend; `node server.js` sobe.

- [ ] **Step 1: Inspecionar o estado quebrado**

Run: `git show HEAD:package.json > /tmp/pkg-head.json; git diff --no-index /tmp/pkg-head.json package.json | head -60`
Confirma que a working copy removeu `@supabase/supabase-js`, `luxon`, `node-cron`, `googleapis`, `@anthropic-ai/sdk`, etc.

- [ ] **Step 2: Restaurar o `package.json` versionado**

Run: `git checkout HEAD -- package.json`
(Descarta a reescrita "React" da raiz. As deps do React ficam só em `frontend/`.)

- [ ] **Step 3: Verificar que o backend sobe**

Run: `node -e "require('./src/lib/supabase.js'); require('luxon'); require('node-cron'); console.log('deps ok')"`
Expected: imprime `deps ok` sem `Cannot find module`.

- [ ] **Step 4: Boot smoke do servidor**

Run: `node server.js &` (esperar log "porta 3000"), depois `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login.html`
Expected: `200`. Encerrar o processo depois.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "fix(pkg): restaurar dependencias do backend na raiz (React fica em frontend/)"
```

---

### Task 2: Dependências do frontend + proxy do Vite + script de screenshot

**Files:**
- Modify: `frontend/package.json`, `frontend/vite.config.js`
- Create: `frontend/scripts/shot.mjs`

**Interfaces:**
- Produces: `npm --prefix frontend run dev` sobe Vite em `:5173` com proxy de `/api`→`:3000`; `shot.mjs` captura PNG claro+escuro.

- [ ] **Step 1: Instalar libs do design system (no frontend)**

Run:
```bash
npm --prefix frontend install recharts react-day-picker date-fns @fontsource/inter
npm --prefix frontend install -D playwright
```

- [ ] **Step 2: Configurar proxy no Vite**

Reescrever `frontend/vite.config.js`:
```js
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api':        { target: 'http://localhost:3000', changeOrigin: false },
      '/login.html': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
});
```

- [ ] **Step 3: Script de screenshot (claro + escuro)**

Create `frontend/scripts/shot.mjs`:
```js
import { chromium } from 'playwright';

const url  = process.argv[2] || 'http://localhost:5173/';
const name = process.argv[3] || 'shot';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
await page.goto(url, { waitUntil: 'networkidle' });
for (const mode of ['dark', 'light']) {
  await page.evaluate(m => document.documentElement.setAttribute('data-mode', m), mode);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `frontend/_shots/${name}-${mode}.png`, fullPage: true });
}
await browser.close();
console.log('shots salvos em frontend/_shots/');
```
(`_shots/` já está no `.gitignore` da raiz.)

- [ ] **Step 4: Verificar dev server + proxy**

Run: `node server.js &` e `npm --prefix frontend run dev &`, depois
`curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/api/overview`
Expected: `401` (proxy chegou no backend, sem cookie) — prova que o proxy funciona. Encerrar processos.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js frontend/scripts/shot.mjs
git commit -m "chore(frontend): recharts/day-picker/inter + proxy vite /api + script de screenshot"
```

---

### Task 3: Tokens de design + ThemeProvider + Inter

**Files:**
- Create: `frontend/src/design-system/tokens.css`
- Create: `frontend/src/theme/ThemeProvider.jsx`
- Rewrite: `frontend/src/index.css`

**Interfaces:**
- Produces:
  - `tokens.css` expõe as variáveis: `--accent, --pos, --neg, --warn, --page-1, --page-2, --blob-1..3, --fg, --fg-2, --fg-3, --glass, --glass-strong, --hair, --hair-soft, --shadow, --inset, --track, --radius` sob `[data-mode="dark"]` e `[data-mode="light"]`.
  - `ThemeProvider` (default export) + hook `useTheme()` → `{ mode, toggle, setMode }`. Aplica `data-mode` em `<html>`, default `dark`, persiste em `localStorage['app-theme']`, respeita `prefers-color-scheme` só quando não há valor salvo.

- [ ] **Step 1: Escrever `tokens.css`** (valores verbatim do spec §6.1, iguais ao mockup aprovado)

```css
:root{ --accent:#0A84FF; --pos:#30D158; --neg:#FF453A; --warn:#FF9F0A; --radius:20px; }
[data-mode="dark"]{
  --page-1:#0b0b0f; --page-2:#0e1014;
  --blob-1:rgba(10,132,255,.30); --blob-2:rgba(48,209,88,.16); --blob-3:rgba(191,90,242,.16);
  --fg:#f5f5f7; --fg-2:rgba(235,235,245,.62); --fg-3:rgba(235,235,245,.35);
  --glass:rgba(255,255,255,.06); --glass-strong:rgba(255,255,255,.09);
  --hair:rgba(255,255,255,.10); --hair-soft:rgba(255,255,255,.06);
  --shadow:0 10px 40px rgba(0,0,0,.45); --inset:inset 0 1px 0 rgba(255,255,255,.10);
  --track:rgba(255,255,255,.10);
}
[data-mode="light"]{
  --page-1:#eef0f5; --page-2:#e7ebf3;
  --blob-1:rgba(10,132,255,.22); --blob-2:rgba(48,209,88,.16); --blob-3:rgba(191,90,242,.14);
  --fg:#1d1d1f; --fg-2:rgba(60,60,67,.62); --fg-3:rgba(60,60,67,.38);
  --glass:rgba(255,255,255,.55); --glass-strong:rgba(255,255,255,.72);
  --hair:rgba(0,0,0,.08); --hair-soft:rgba(0,0,0,.05);
  --shadow:0 10px 40px rgba(0,0,0,.10); --inset:inset 0 1px 0 rgba(255,255,255,.7);
  --track:rgba(0,0,0,.08);
}
```

- [ ] **Step 2: Reescrever `index.css`** — Tailwind v4 + Inter + fundo com "borrões" + primitivo `.glass`

```css
@import "tailwindcss";
@import "@fontsource/inter/400.css";
@import "@fontsource/inter/500.css";
@import "@fontsource/inter/600.css";
@import "@fontsource/inter/700.css";
@import "./design-system/tokens.css";

*{margin:0;padding:0;box-sizing:border-box}
html,body,#root{height:100%;width:100%}
body{
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  color:var(--fg); letter-spacing:-.01em; -webkit-font-smoothing:antialiased;
  background:
    radial-gradient(60vw 50vh at 12% 8%, var(--blob-1), transparent 60%),
    radial-gradient(50vw 50vh at 92% 22%, var(--blob-3), transparent 62%),
    radial-gradient(55vw 55vh at 78% 96%, var(--blob-2), transparent 60%),
    linear-gradient(160deg, var(--page-1), var(--page-2));
  background-attachment:fixed; transition:background .4s ease,color .3s ease;
}
.num{font-variant-numeric:tabular-nums; letter-spacing:-.02em}
.pos{color:var(--pos)} .neg{color:var(--neg)}
.glass{
  background:var(--glass); border:1px solid var(--hair); border-radius:var(--radius);
  box-shadow:var(--shadow), var(--inset);
  -webkit-backdrop-filter:blur(30px) saturate(180%); backdrop-filter:blur(30px) saturate(180%);
}
@supports not (backdrop-filter: blur(1px)){ .glass{ background:var(--glass-strong) } }
@media (prefers-reduced-motion: reduce){ *{transition-duration:.01ms!important;animation-duration:.01ms!important} }
```

- [ ] **Step 3: Escrever `ThemeProvider.jsx`**

```jsx
import { createContext, useContext, useEffect, useState } from 'react';
const KEY = 'app-theme';
const Ctx = createContext(null);

function initialMode(){
  const saved = localStorage.getItem(KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function ThemeProvider({ children }){
  const [mode, setMode] = useState(initialMode);
  useEffect(() => {
    document.documentElement.setAttribute('data-mode', mode);
    localStorage.setItem(KEY, mode);
  }, [mode]);
  const toggle = () => setMode(m => (m === 'dark' ? 'light' : 'dark'));
  return <Ctx.Provider value={{ mode, setMode, toggle }}>{children}</Ctx.Provider>;
}
export const useTheme = () => useContext(Ctx);
```

- [ ] **Step 4: Verificar (temporário)** — envolver o App atual com `ThemeProvider` e checar no dev server que `<html data-mode="dark">` por padrão e que recarregar preserva o modo. Screenshot não necessário aqui.

Run: `npm --prefix frontend run dev` → abrir `:5173`, no console: `document.documentElement.getAttribute('data-mode')` → `"dark"`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/design-system/tokens.css frontend/src/theme/ThemeProvider.jsx frontend/src/index.css
git commit -m "feat(ds): tokens claro/escuro + ThemeProvider (escuro padrao) + Inter"
```

---

## Fase 1B — Design system (primitivos)

### Task 4: Formatadores (função pura, com check em node)

**Files:**
- Create: `frontend/src/lib/format.js`

**Interfaces:**
- Produces: `BRL(n) -> "R$ 1.234"`, `PCT(n,dig=1) -> "71,1%"`, `NUM(n) -> "1.234"`, `INT(n)`, `SIGNPCT(n)` (com `+/−`). Locale pt-BR, sem centavos em BRL por padrão (`maximumFractionDigits:0`).

- [ ] **Step 1: Escrever `format.js`**

```js
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export const BRL = n => 'R$ ' + nf0.format(Math.round(Number(n) || 0));
export const NUM = n => nf0.format(Number(n) || 0);
export const INT = NUM;
export const PCT = (n, d = 1) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(Number(n) || 0) + '%';
export const SIGNPCT = (n, d = 1) => (Number(n) >= 0 ? '+' : '−') + PCT(Math.abs(Number(n) || 0), d);
```

- [ ] **Step 2: Check em node**

Create `frontend/scripts/_check-format.mjs`:
```js
import { BRL, PCT, SIGNPCT } from '../src/lib/format.js';
import assert from 'node:assert';
assert.equal(BRL(12480), 'R$ 12.480');
assert.equal(PCT(71.1), '71,1%');
assert.equal(SIGNPCT(-8), '−8,0%');
console.log('format ok');
```
Run: `node frontend/scripts/_check-format.mjs`
Expected: `format ok` (sem AssertionError).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/format.js frontend/scripts/_check-format.mjs
git commit -m "feat(ds): formatadores pt-BR (BRL/PCT/NUM tabular) + check"
```

---

### Task 5: Primitivos base — GlassCard, Segment, ThemeToggle, Gauge

**Files:**
- Create: `frontend/src/design-system/GlassCard.jsx`, `Segment.jsx`, `ThemeToggle.jsx`, `Gauge.jsx`, `index.js`, `_demo.jsx`

**Interfaces:**
- Produces:
  - `GlassCard({ className, children, hover, ...rest })` → `<div class="glass ...">`; `hover` adiciona lift/translateY(-2px) + sombra no hover.
  - `Segment({ options:[{value,label}], value, onChange })` → controle segmentado (7d/14d/30d).
  - `ThemeToggle()` → botão ☾/☀ que chama `useTheme().toggle()`.
  - `Gauge({ value, cap })` → anel SVG (dashoffset ∝ value) + número central `.num` + legenda.

- [ ] **Step 1: Escrever os 4 componentes** (usando classes `glass`/tokens; ícones inline).

`GlassCard.jsx`:
```jsx
export default function GlassCard({ className = '', children, hover = false, ...rest }){
  return (
    <div className={`glass ${hover ? 'ds-hover' : ''} ${className}`} {...rest}>{children}</div>
  );
}
```
`Segment.jsx`:
```jsx
export default function Segment({ options, value, onChange }){
  return (
    <div className="ds-seg">
      {options.map(o => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
```
`ThemeToggle.jsx`:
```jsx
import { useTheme } from '../theme/ThemeProvider';
export default function ThemeToggle(){
  const { mode, toggle } = useTheme();
  return <button className="ds-icbtn" onClick={toggle} title="Claro / Escuro">{mode === 'dark' ? '☾' : '☀'}</button>;
}
```
`Gauge.jsx`:
```jsx
export default function Gauge({ value = 0.69, cap = '' }){
  const r = 36, c = 2 * Math.PI * r, off = c * (1 - Math.min(value, 1));
  return (
    <div className="ds-gauge">
      <svg width="86" height="86" viewBox="0 0 86 86">
        <circle cx="43" cy="43" r={r} fill="none" stroke="var(--track)" strokeWidth="9"/>
        <circle cx="43" cy="43" r={r} fill="none" stroke="var(--pos)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 43 43)"/>
      </svg>
      <div><div className="big num">{value.toFixed(2).replace('.', ',')}</div><div className="cap">{cap}</div></div>
    </div>
  );
}
```

- [ ] **Step 2: Classes de componente no `index.css`** — adicionar `.ds-seg`, `.ds-icbtn`, `.ds-gauge`, `.ds-hover` (extrair do mockup: `.seg`, `.icbtn`, `.gauge`, `.card-hv`). Copiar as regras verbatim do mockup, renomeando os prefixos para `ds-`.

- [ ] **Step 3: Barrel `index.js`** exportando todos os primitivos criados até aqui.

- [ ] **Step 4: Galeria `_demo.jsx`** — página que renderiza os 4 primitivos lado a lado, dentro de `ThemeProvider`, montável via uma rota `?demo=1` no `App.jsx` (temporária).

- [ ] **Step 5: Screenshot claro+escuro**

Run: `node frontend/scripts/shot.mjs "http://localhost:5173/?demo=1" primitivos`
Verificar `frontend/_shots/primitivos-dark.png` e `-light.png`: vidro, segment com item ativo azul, toggle, gauge verde — batendo com o mockup.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/design-system frontend/src/index.css
git commit -m "feat(ds): GlassCard, Segment, ThemeToggle, Gauge + galeria"
```

---

### Task 6: KpiCard + GlassTable

**Files:**
- Create: `frontend/src/design-system/KpiCard.jsx`, `GlassTable.jsx`
- Modify: `frontend/src/design-system/index.js`, `frontend/src/design-system/_demo.jsx`

**Interfaces:**
- Consumes: `GlassCard`, `format.js`.
- Produces:
  - `KpiCard({ label, value, delta, deltaTone='up', spark=[], tone })` → rótulo uppercase, valor `.num` 26px (classe `.pos/.neg` via `tone`), chip de variação (`up`/`down`), sparkline SVG a partir de `spark` (array de números, normalizado no componente).
  - `GlassTable({ columns:[{key,label,align,render?}], rows })` → tabela dentro de `GlassCard`, cabeçalho hairline uppercase, células 13px, alinhamento por coluna, números `.num`.

- [ ] **Step 1:** Escrever `KpiCard.jsx` (sparkline: mapear `spark` para `points` de um `<polyline>` em viewBox 0 0 120 26; stroke = `var(--accent)` ou `var(--pos)` conforme `tone`).
- [ ] **Step 2:** Escrever `GlassTable.jsx` (usa `columns[].render(row)` quando presente; senão `row[col.key]`).
- [ ] **Step 3:** Classes `.ds-kpi`, `.ds-tbl` no `index.css` (verbatim do mockup: `.kpi`, `.tbl`, `.chip`).
- [ ] **Step 4:** Adicionar KpiCard + GlassTable à galeria `_demo.jsx` com dados fixos (os do mockup).
- [ ] **Step 5: Screenshot**: `node frontend/scripts/shot.mjs "http://localhost:5173/?demo=1" kpi-table` → conferir 4 KPIs + tabela batendo com o mockup (claro+escuro).
- [ ] **Step 6: Commit**
```bash
git add frontend/src/design-system frontend/src/index.css
git commit -m "feat(ds): KpiCard (sparkline+variacao) e GlassTable"
```

---

### Task 7: Chart (Recharts) — AreaTrend + BarList

**Files:**
- Create: `frontend/src/design-system/Chart.jsx`
- Modify: `frontend/src/design-system/index.js`, `_demo.jsx`

**Interfaces:**
- Consumes: `recharts`.
- Produces:
  - `AreaTrend({ data, series })` — `data`: array de objetos; `series`: `[{ key, color, label }]`. Área com gradiente (opacidade .3→0), linha 2.5px, grade horizontal hairline, eixos sem molduras, `<Tooltip>` com painel `.glass`. `ResponsiveContainer` 100%×220.
  - `BarList({ items:[{label,value,pct}] })` — barras horizontais (trilho `--track`, preenchimento gradiente azul), rótulo + valor `.num`.

- [ ] **Step 1:** Escrever `Chart.jsx` com `AreaChart`/`Area`/`CartesianGrid`/`XAxis`/`YAxis`/`Tooltip` do Recharts. Cores via `stroke={color}` e `<linearGradient>` por série. Tooltip custom `content={<GlassTooltip/>}` renderizando `.glass`.
- [ ] **Step 2:** `BarList` (sem Recharts — divs + tokens, igual ao mockup `.bar`).
- [ ] **Step 3:** Classes `.ds-bar` no `index.css` (verbatim do mockup `.bars/.bar`).
- [ ] **Step 4:** Galeria: `AreaTrend` com `series=[{key:'faturamento',color:'var(--pos)'},{key:'investimento',color:'var(--accent)'}]` e dados fixos; `BarList` com países do mockup.
- [ ] **Step 5: Screenshot**: `node frontend/scripts/shot.mjs "http://localhost:5173/?demo=1" chart` → conferir área com gradiente + barras nos dois modos.
- [ ] **Step 6: Commit**
```bash
git add frontend/src/design-system frontend/src/index.css
git commit -m "feat(ds): grafico AreaTrend (Recharts) + BarList estilo Apple"
```

---

### Task 8: DateRange (react-day-picker, estilo Apple)

**Files:**
- Create: `frontend/src/design-system/DateRange.jsx`
- Modify: `frontend/src/design-system/index.js`, `_demo.jsx`

**Interfaces:**
- Consumes: `react-day-picker`, `date-fns`.
- Produces: `DateRange({ value:{from,to}, onChange, presets=true })` — botão-gatilho (mostra intervalo formatado pt-BR) que abre painel `.glass` com `<DayPicker mode="range">`; dias arredondados, selecionados em `--accent`, hover suave; presets 7d/14d/30d resolvidos com `date-fns` **a partir de "hoje"** recebido por prop (não `new Date()` cru, para respeitar fuso — a página passa o hoje-BR).

- [ ] **Step 1:** Escrever `DateRange.jsx` (popover controlado por estado local; fecha em click-outside/Escape).
- [ ] **Step 2:** Estilizar o DayPicker via CSS (`.ds-daypicker`) sobrescrevendo as classes do react-day-picker com os tokens (selecionado `--accent`, hoje com anel, hover `--hair-soft`).
- [ ] **Step 3:** Galeria: um `DateRange` com valor inicial (últimos 14 dias).
- [ ] **Step 4: Screenshot** (com o painel aberto): `node frontend/scripts/shot.mjs "http://localhost:5173/?demo=1&cal=open" calendario`.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/design-system frontend/src/index.css
git commit -m "feat(ds): DateRange estilo Apple (react-day-picker) + presets"
```

---

## Fase 1C — Shell + dados

### Task 9: `useApi` com cookie + 401→login

**Files:**
- Modify: `frontend/src/hooks/useApi.js`

**Interfaces:**
- Produces: `useApi(endpoint, deps=[])` → `{ data, loading, error }`. Base **relativa** `/api` (via proxy no dev, same-origin em prod), `credentials:'include'`. `401` → `window.location.href='/login.html'`. Também exporta `apiGet(path)` (promise).

- [ ] **Step 1:** Reescrever `useApi.js`:
```js
import { useEffect, useState } from 'react';
export async function apiGet(path){
  const res = await fetch(`/api${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  if (res.status === 401){ window.location.href = '/login.html'; return null; }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.erro || `HTTP ${res.status}`);
  return data;
}
export function useApi(endpoint, deps = []){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null);
  useEffect(() => { let alive=true; setLoading(true);
    apiGet(endpoint).then(d => { if(alive){ setData(d); setError(null); } })
      .catch(e => { if(alive){ setError(e.message); setData(null); } })
      .finally(() => { if(alive) setLoading(false); });
    return () => { alive=false; };
  }, deps); // eslint-disable-line
  return { data, loading, error };
}
```

- [ ] **Step 2: Verificar contra dados reais** — com `node server.js` + login feito no navegador (cookie válido em `:3000`), abrir `:5173`, no console: `fetch('/api/overview',{credentials:'include'}).then(r=>r.json()).then(d=>console.log(Object.keys(d)))`.
Expected: imprime as chaves reais (ex.: `insights`, `trend`, …) — **anotar a forma exata** para as telas.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/hooks/useApi.js
git commit -m "feat(data): useApi com cookie same-origin + 401->login"
```

---

### Task 10: AppShell + Sidebar + Topbar

**Files:**
- Create: `frontend/src/layouts/AppShell.jsx`, `frontend/src/components/Topbar.jsx`
- Rewrite: `frontend/src/components/Sidebar.jsx`

**Interfaces:**
- Consumes: `GlassCard`, `Segment`, `ThemeToggle`, `DateRange`.
- Produces:
  - `Sidebar({ active, onNavigate })` — `.glass` sticky, marca "2Junior's", nav com os itens reais (`overview, campaigns, countries` ativos na Fase 1; demais como itens desabilitados/"em breve"): Visão geral, Campanhas, Países, GAM, Funil, Relatórios, Contas, Diretório, Domínios. Item ativo com tinta azul + indicador à esquerda.
  - `Topbar({ title, subtitle, right })` — `.glass`, título 22px + subtítulo, slot `right` (período + sino + `ThemeToggle`).
  - `AppShell({ active, onNavigate, title, subtitle, headerRight, children })` — grid `236px 1fr` (colapsa <960px), compõe Sidebar + Topbar + conteúdo.

- [ ] **Step 1:** Escrever Sidebar/Topbar/AppShell (estrutura e classes verbatim do mockup: `.side/.nav/.top/.tools/.bell`).
- [ ] **Step 2:** Classes `.ds-side`, `.ds-nav`, `.ds-top` no `index.css` (do mockup).
- [ ] **Step 3:** `App.jsx` temporário renderizando `AppShell` com conteúdo vazio + `Segment` e `ThemeToggle` no `headerRight`.
- [ ] **Step 4: Screenshot**: `node frontend/scripts/shot.mjs "http://localhost:5173/" shell` → shell idêntico ao mockup (sidebar+topbar) nos dois modos.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/layouts frontend/src/components frontend/src/index.css
git commit -m "feat(shell): AppShell + Sidebar (nav real) + Topbar de vidro"
```

---

## Fase 1D — Telas (dados reais)

### Task 11: Overview

**Files:**
- Rewrite: `frontend/src/pages/Overview.jsx`

**Interfaces:**
- Consumes: `useApi('/overview'...)`, todos os primitivos, `AppShell`, `format.js`. Usa a **forma real** anotada na Task 9 (esperado: `insights` com faturamento/investimento/lucro/roas do dia; `trend[]` com `{date,faturamento,investimento,lucro,roas}`; agregados por país e top UTMs/campanhas).
- Produces: página completa `Overview` (a que foi validada no mockup), ligada aos dados reais, com estados de loading (skeleton em vidro) e erro.

- [ ] **Step 1:** Montar o período (Segment 7/14/30d + DateRange) e passar as datas ao `useApi` (deps = [from,to]). "Hoje" via valor vindo da API/util (não `new Date()` cru).
- [ ] **Step 2:** Mapear `insights`→4 `KpiCard` (Investimento, Receita GAM, Lucro, ROI) com `spark` derivado de `trend[]`. Números via `format.js`.
- [ ] **Step 3:** `AreaTrend` com `trend[]` (séries faturamento×investimento). `BarList` de receita por país. `Gauge` de break-even (valor vindo do backend; se não houver, ocultar o card — sem inventar número).
- [ ] **Step 4:** `GlassTable` "Top campanhas" a partir dos dados de campanha do endpoint (colunas: campanha, país, gasto, receita, ROI).
- [ ] **Step 5:** Estados: `loading` → skeletons `.glass`; `error` → card de erro discreto. Nada de dado inventado.
- [ ] **Step 6: Screenshot + conferência de números**: `node frontend/scripts/shot.mjs "http://localhost:5173/" overview`. Comparar (a) visual vs mockup aprovado, (b) **KPIs vs o dashboard atual** (`/dashboard.html`) no mesmo período — devem bater.
- [ ] **Step 7: Commit**
```bash
git add frontend/src/pages/Overview.jsx
git commit -m "feat(tela): Overview Apple Liquid Glass com dados reais"
```

---

### Task 12: Campanhas

**Files:**
- Rewrite: `frontend/src/pages/Campaigns.jsx`

**Interfaces:**
- Consumes: endpoint de campanhas (confirmar na Task 9/na leitura de `src/app/api/dashboard/route.js` qual entrega a lista por `campaign_id`), primitivos, `AppShell`.
- Produces: tela Campanhas — tabela/lista por campanha com gasto, receita atribuída, ROI, badge de estrutura (E1/E2…), filtros (país, estrutura, busca). Ganchos de clique para drilldown ficam como no-op nesta fase (drilldown é Fase 3).

- [ ] **Step 1:** Buscar dados (deps do período). Anotar a forma real do endpoint antes de mapear (sem inventar campos).
- [ ] **Step 2:** `GlassTable` com colunas definidas; formatação via `format.js`; ROI com `.pos/.neg`.
- [ ] **Step 3:** Filtros no topo (Segment/inputs de vidro): país, estrutura, busca por nome. Filtragem client-side sobre os dados recebidos.
- [ ] **Step 4:** Loading/erro como na Overview.
- [ ] **Step 5: Screenshot**: `node frontend/scripts/shot.mjs "http://localhost:5173/?tab=campaigns" campanhas` (claro+escuro).
- [ ] **Step 6: Commit**
```bash
git add frontend/src/pages/Campaigns.jsx
git commit -m "feat(tela): Campanhas em vidro com filtros"
```

---

### Task 13: Países

**Files:**
- Rewrite: `frontend/src/pages/Countries.jsx`

**Interfaces:**
- Consumes: dados de país (do endpoint de overview/dashboard já usado), primitivos, `AppShell`.
- Produces: grade de cards por país (bandeira, gasto, receita, ROI, e as métricas que o backend entregar), com estado de loading/erro. Card clicável (detalhe é fase posterior; clique no-op nesta fase).

- [ ] **Step 1:** Buscar/derivar agregado por país (reusar dados já disponíveis). Anotar forma real.
- [ ] **Step 2:** Grade responsiva de `GlassCard` (3 col → 2 → 1), cada card com bandeira (emoji por sigla), valores `format.js`, ROI colorido, mini-`BarList` opcional.
- [ ] **Step 3:** Loading/erro.
- [ ] **Step 4: Screenshot**: `node frontend/scripts/shot.mjs "http://localhost:5173/?tab=countries" paises`.
- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/Countries.jsx
git commit -m "feat(tela): Paises em cards de vidro"
```

---

## Fase 1E — Amarração & validação

### Task 14: App/rotas + validação final local (sem deploy)

**Files:**
- Rewrite: `frontend/src/App.jsx`, `frontend/src/main.jsx`

**Interfaces:**
- Produces: App com `ThemeProvider` no topo, navegação entre Overview/Campanhas/Países via estado (`?tab=` para deep-link e screenshots), remoção da galeria `_demo` do fluxo normal (mantida atrás de `?demo=1`).

- [ ] **Step 1:** `main.jsx` monta `<ThemeProvider><App/></ThemeProvider>`. `App.jsx` roteia por `active` (default `overview`), lendo `?tab=`/`?demo=`.
- [ ] **Step 2:** Remover o brilho menta legado do `.glass-card` antigo do scaffold (garantir que só os tokens Apple valem; buscar `#00E5B4` em `frontend/src` e zerar).

Run: `grep -rn "00E5B4\|00e5b4" frontend/src` → Expected: nenhum resultado.

- [ ] **Step 3: Build de produção passa (sem publicar)**

Run: `npm --prefix frontend run build`
Expected: build OK, `frontend/dist` gerado. **Não** servir/deployar.

- [ ] **Step 4: Checklist de validação local** (com `node server.js` + login):
  - [ ] Overview, Campanhas, Países renderizam dados reais, sem 401.
  - [ ] Toggle claro/escuro funciona e persiste; **escuro é o default** em aba nova.
  - [ ] Screenshots das 3 telas × 2 modos batendo com o mockup aprovado.
  - [ ] KPIs da Overview conferem com o `/dashboard.html` atual no mesmo período.
  - [ ] `git status` não mostra mudança em `server.js`/`src/`/`package.json` do backend.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/App.jsx frontend/src/main.jsx frontend/src/index.css
git commit -m "feat(app): rotas Overview/Campanhas/Paises + limpeza do glow legado"
```

- [ ] **Step 6: Parar aqui.** Apresentar as telas ao usuário para aprovação. **Sem `git push`, sem merge, sem deploy** até o usuário aprovar e pedir a virada (que é escopo da fase de cutover).

---

## Self-Review (autor)

**Cobertura do spec:**
- §2 decisões (React/frontend, azul, claro+escuro escuro-padrão, Inter, Recharts, date picker próprio, não-deploy) → Tasks 1–3, 7, 8, 14. ✓
- §3 restrições (sem API/dados, branch, validação local, dash atual intacto) → Global Constraints + Tasks 1, 9, 11–14. ✓
- §4.3 restaurar package.json → Task 1. ✓
- §5 auth/serving (cookie, proxy dev, build) → Tasks 2, 9, 14. ✓
- §6 tokens/tipografia/vidro/gráficos/calendário → Tasks 3, 5–8. ✓
- §7 telas Overview/Campanhas/Países → Tasks 11–13. ✓
- §9 critérios de sucesso → checklist Task 14. ✓

**Placeholders:** As Tasks 11–13 dependem da forma real do endpoint — por isso a Task 9 Step 2 obriga anotar as chaves reais antes de mapear. Não é "TODO": é sequência com dependência explícita (a forma exata só existe em runtime). Demais passos têm código ou spec de componente concreto (props + estrutura + classe).

**Consistência de tipos:** `GlassCard`, `KpiCard({label,value,delta,deltaTone,spark,tone})`, `GlassTable({columns,rows})`, `AreaTrend({data,series})`, `BarList({items})`, `Gauge({value,cap})`, `DateRange({value,onChange})`, `useApi/apiGet` — nomes usados nas telas batem com as assinaturas definidas nas Tasks 5–9. ✓

**Nota de granularidade:** primitivos visuais grandes (Tasks 5–8, 10–13) são especificados por assinatura + estrutura + classe do mockup + aceitação por screenshot, em vez de JSX literal completo — adequado a um redesign visual e ao método de verificação do projeto (screenshot, não teste unitário).
