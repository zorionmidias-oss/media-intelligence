# Apple Liquid Glass — Redesign do Dashboard (React)

**Data:** 2026-08-30
**Status:** Design aprovado visualmente (mockup Overview validado) — aguardando revisão do spec
**Escopo deste spec:** Fase 1 (design system + Overview + Campanhas + Países). Fases 2 e 3 documentadas em alto nível; cada uma terá seu próprio spec/plano.

---

## 1. Objetivo

Reconstruir o dashboard da Media Intelligence adotando a linguagem visual **Apple "Liquid Glass"** (glassmorphism autêntico, tipografia Apple, gráficos e calendário no estilo Apple, claro + escuro), numa base **React** limpa e componentizada em `frontend/`.

O **backend Express e as APIs `/api/*` não mudam** — é uma reconstrução de camada de apresentação, não de lógica de negócio. Zero mudança em sync, receita, gasto, fuso ou upsert.

---

## 2. Decisões fechadas (com o usuário)

| Tema | Decisão |
|------|---------|
| Arquitetura | Reescrita **React** em `frontend/` (React 19 + Vite + Tailwind). Backend intacto. |
| Execução | **Faseada**, núcleo primeiro. |
| Cor de acento | **Azul Apple `#0A84FF`** (fidelidade máxima ao macOS). |
| Modo | **Claro + escuro** com toggle; **escuro é o padrão**. |
| Tipografia | **Inter** auto-hospedada (stand-in da SF Pro, consistente no Windows) + números tabulares. |
| Gráficos | **Recharts** (nativo React), estilizado no espírito Apple. |
| Calendário/período | **Date picker próprio** no estilo Apple (substitui o flatpickr). |
| Produção | **Nada sobe pra produção até estar tudo pronto e aprovado.** Validação toda local antes disso. |

---

## 3. Restrições globais (invioláveis)

- **Sem mudança de API/dados.** As telas consomem os endpoints de leitura que já existem (`/api/overview`, `/api/dashboard`, `/api/reports-gam`, etc.). Nenhum cálculo de receita/gasto/ROI/fuso é reimplementado no front — os números vêm prontos do backend (invariantes de negócio permanecem no servidor).
- **Não deployar durante a obra.** Todo o trabalho fica numa **branch** dedicada, **fora do `main`** (que faz auto-deploy no Render). Só se faz merge/deploy na virada final, com aprovação explícita.
- **Validação local a cada passo:** `node server.js` + `frontend` em dev, conferência em `localhost`, e **screenshots** (Playwright/Chrome, padrão `scripts/_shot.js`) antes de pedir aprovação de cada tela.
- O **dashboard atual (`public/dashboard.html`) continua funcionando** e sendo o que está no ar durante toda a obra.

---

## 4. Arquitetura

### 4.1 Camadas

```
Express (server.js)  ──  APIs /api/* (inalteradas)  ──  Supabase / Meta / GAM
        │
        ├─ hoje: serve public/dashboard.html (monólito) atrás de requireAuth  ← permanece
        └─ no fim: serve frontend/dist (SPA React) atrás de requireAuth       ← virada final

frontend/ (React + Vite + Tailwind)
  src/
    design-system/     tokens (cores, tipografia, glass, motion) + primitivos
      GlassCard, GlassButton, GlassTable, KpiCard, DateRange, Chart, Segment, ThemeToggle…
    hooks/useApi.js    fetch com cookie (same-origin), loading/erro
    layouts/AppShell   sidebar de vidro + topbar + área de conteúdo
    pages/             Overview, Campaigns, Countries (Fase 1)
    theme/             ThemeProvider (claro/escuro, localStorage, prefers-color-scheme)
    App.jsx, main.jsx
```

### 4.2 Design de isolamento

- **Design system** é a fonte única dos "tijolinhos" visuais. Nenhuma tela redefine glass/cor/raio na mão — tudo sai dos tokens e dos primitivos. Trocar um token muda o app inteiro de forma coerente.
- Cada **página** é um componente focado: busca seus dados via `useApi`, monta os primitivos, sem lógica de negócio embutida.
- Cada **primitivo** responde: o que faz, como se usa, do que depende — testável e entendível isolado.

### 4.3 Correção do `package.json` da raiz

O `package.json` da raiz foi reescrito (working copy) removendo dependências que o backend precisa (`@supabase/supabase-js`, `luxon`, `node-cron`, `googleapis`, etc.). **Isso será revertido** — a raiz volta a ter todas as dependências do backend. As dependências do React ficam **só** em `frontend/package.json`. Scripts de conveniência (`concurrently` pra rodar backend + frontend juntos) são bem-vindos, mas sem mexer nas deps do servidor.

---

## 5. Integração com o backend

### 5.1 Autenticação (cookie JWT)

- As APIs são protegidas por `requireAuth` (JWT em cookie, `credentials: same-origin`). O `useApi` atual do scaffold **não envia o cookie** e usa base `http://localhost:3000` fixa → daria 401. Corrigir para:
  - **dev:** Vite com **proxy** de `/api` (e `/login.html`) → `http://localhost:3000`, repassando cookies.
  - **prod:** base relativa `/api`, `credentials: 'include'`, servido same-origin pelo Express.
- `401` → redireciona para `/login.html` (mesmo comportamento do `api.js` atual).

### 5.2 Serving e build

- **Dev:** dois processos — Express (`:3000`) e Vite (`:5173`, com proxy). Um script `npm run dev` sobe os dois.
- **Prod (virada final):** `cd frontend && npm run build` gera `frontend/dist`; o Express passa a servir `dist` **atrás de `requireAuth`** na rota principal, mantendo o monólito antigo acessível numa rota de fallback até a virada estar 100% validada. Ajuste do build no Render (rodar o build do frontend) entra só na fase de virada.

---

## 6. Design System (tokens = "lei")

### 6.1 Cor

**Acento:** `#0A84FF`. **Semânticos:** positivo `#30D158`, negativo `#FF453A`, alerta `#FF9F0A`.

Tokens de superfície separados por modo (validados no mockup):

| Token | Escuro | Claro |
|-------|--------|-------|
| Página (gradiente + "borrões" de cor) | `#0b0b0f→#0e1014` | `#eef0f5→#e7ebf3` |
| Vidro | `rgba(255,255,255,.06)` | `rgba(255,255,255,.55)` |
| Vidro forte | `rgba(255,255,255,.09)` | `rgba(255,255,255,.72)` |
| Hairline (borda) | `rgba(255,255,255,.10)` | `rgba(0,0,0,.08)` |
| Texto 1/2/3 | `#f5f5f7` / `.62` / `.35` | `#1d1d1f` / `.62` / `.38` |
| Sombra | `0 10px 40px rgba(0,0,0,.45)` | `0 10px 40px rgba(0,0,0,.10)` |

Regra WCAG: cor nunca sozinha pra significado — sempre com ícone/rótulo.

### 6.2 Tipografia

- **Inter** (400/500/600/700) para UI. Números com `font-variant-numeric: tabular-nums` e `letter-spacing:-.02em` (alinhamento de dashboard Apple).
- Hierarquia: título de página 22px/700; seção 14px/600; rótulo 11px/600 uppercase; corpo 13–14px/400–500.

### 6.3 Vidro, forma e movimento

- Vidro: `backdrop-filter: blur(30px) saturate(180%)`, borda hairline 1px, cantos **20px**, sombra suave + `inset 0 1px 0` de brilho superior. Fallback sem `backdrop-filter`: cor sólida translúcida.
- Raios: 20px (cards), 11px (nav/inputs), 8–10px (chips/segment), 999px (pills).
- Movimento: transições 150–300ms, easing suave; respeita `prefers-reduced-motion`. Blur limitado a poucas camadas por tela (performance).

### 6.4 Gráficos (Recharts)

Área com gradiente (receita/gasto), linha 2.5px, grade hairline horizontal, sem molduras pesadas, tooltip de vidro. Cores dos tokens semânticos.

### 6.5 Calendário / período

- **Segment** rápido (7d / 14d / 30d) + **date picker próprio** (intervalo) no estilo Apple: painel de vidro, dias arredondados, seleção azul Apple, hover suave. "Hoje" respeita o fuso São Paulo (via API/util existente) — sem `new Date().toISOString()` cru.

---

## 7. Telas da Fase 1

Cada tela reusa endpoint(s) de leitura existentes; o mapeamento exato tela→endpoint é fixado no plano de implementação.

### 7.1 Overview (mockup já validado)
Sidebar + topbar (título, período, sino, toggle). 4 KPIs de vidro (Investimento, Receita GAM líq., Lucro, ROI) com sparkline e variação; gráfico Receita × Gasto; Receita por país (barras); medidor de break-even; tabela Top campanhas. Fonte: `/api/overview` (+ o que o handler já entrega).

### 7.2 Campanhas
Lista/tabela de campanhas por `campaign_id` com gasto, receita atribuída, ROI, badges de estrutura (E1/E2…). Filtros (país, estrutura, busca). Preparar ganchos para o drilldown de conjuntos (implementado na Fase 3). Fonte: endpoint de dashboard/campanhas existente.

### 7.3 Países
Grade de cards por país (bandeira, gasto, receita, ROI, sessões/RPM conforme o backend entrega), clicável para detalhe. Fonte: dados de país já disponíveis nos endpoints de leitura.

---

## 8. Fora de escopo (Fase 1)

- Fases 2/3 (GAM, Funil, Relatórios, Contas, Diretório, Domínios; modais pesados; gestão de acessos; virada final e ajuste de build no Render) — specs próprios.
- Qualquer mudança em API, cálculo, schema, sync, auth de backend.
- Mobile dedicado (`mobile.html`) — a responsividade da SPA cobre telas pequenas; decisão de aposentar o `mobile.html` fica pra depois.

---

## 9. Critérios de sucesso (Fase 1)

- [ ] Overview, Campanhas e Países renderizando **dados reais** via APIs existentes, sem 401 (cookie ok).
- [ ] Claro + escuro com toggle persistente (localStorage + `prefers-color-scheme`); **escuro padrão**.
- [ ] Visual bate com o mockup aprovado (glass, azul Apple, Inter, cantos, sombras) em claro e escuro.
- [ ] Gráficos em Recharts e date picker próprio no estilo Apple, funcionais.
- [ ] `package.json` da raiz restaurado; backend roda normalmente (`node server.js` sem faltar dependência).
- [ ] Tudo validado em `localhost` + screenshots; **nada em produção**; trabalho numa branch fora do `main`.
- [ ] Números conferem com o dashboard atual (mesma fonte de dados).

---

## 10. Riscos e mitigação

| Risco | Mitigação |
|------|-----------|
| Virar a chave cedo e quebrar o que está no ar | Branch dedicada; monólito permanece; virada só no fim com aprovação. |
| `package.json` quebrado ir pro deploy | Restaurar a raiz logo no início; deps do React isoladas em `frontend/`. |
| 401 nas chamadas do React | `useApi` com cookie; proxy no dev; base relativa em prod. |
| Divergência de números vs. dash atual | Reusar os mesmos endpoints; conferir lado a lado nas 3 telas. |
| Performance do blur | Poucas camadas de vidro por tela; fallback sólido; `prefers-reduced-motion`. |
| Fidelidade da SF no Windows | Inter (decisão confirmada). |

---

## 11. Próximos passos

1. Revisão deste spec pelo usuário.
2. `writing-plans` → plano de implementação detalhado da **Fase 1**.
3. Execução com checkpoints e validação local por tela.
