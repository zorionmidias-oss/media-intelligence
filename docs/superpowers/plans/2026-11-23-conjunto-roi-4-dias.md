# ROI · 4 dias por conjunto (dashboard atual) — Plano de implementação

> Spec: `docs/superpowers/specs/2026-11-23-conjunto-roi-4-dias-design.md`. Execução inline.

**Goal:** coluna "ROI · 4 dias" (hoje + 3 anteriores, fuso SP) no expand de conjuntos do `public/dashboard.html`.
**Architecture:** só front. Segunda chamada ao `/api/drilldown` existente com janela fixa; usa `roi_serie` já devolvido.
**Tech Stack:** HTML/CSS/JS inline no monólito `public/dashboard.html`. Sem testes automatizados no repo.

## Global Constraints
- Não tocar backend nem cálculo de receita/gasto/fuso. Não tocar `/app` (frontend/).
- Unidade `x` = `1 + roi%/100`; cores via `corROI` (≥1.2 ok · ≥1 warn · <1 bad).
- Hoje esmaecido com title "parcial — dia em andamento". Dia sem gasto = `—`.
- Falha da chamada dos 4 dias não bloqueia a tabela.

### Task 1: CSS da coluna
**Files:** Modify `public/dashboard.html` (após `.ud-pill.bad`, ~l.722)
- [ ] Adicionar classes `.ud-r4`, `.ud-r4 .r4c`, `em`, `i`, `small`, `.r4c.parcial{opacity:.5}`.

### Task 2: Dados da janela fixa
**Files:** Modify `public/dashboard.html` (`toggleUtmExpand`, ~l.6310)
**Produces:** `janela4dBR(): string[4]` (YYYY-MM-DD, D-3…hoje); `renderUtmAdsets(box,utm,d,rps,d4)` com `d4` = resposta do drilldown da janela ou `null`.
- [ ] `janela4dBR()` a partir de `hojeBR()`.
- [ ] Em `toggleUtmExpand`, disparar fetch da janela em paralelo (`.then(ok?json:null).catch(()=>null)`) e passar a `renderUtmAdsets`.

### Task 3: Render da coluna
**Files:** Modify `public/dashboard.html` (`renderUtmAdsets`, ~l.6347)
**Consumes:** `janela4dBR`, `d4.adsets[].{adset_id,roi_serie[{data,roi}]}`.
- [ ] `roi4dHtml(serie,dias)` → 4 slots (valor `x`, mini-barra ∝ |x−1|, `DD/MM`).
- [ ] `<th>ROI · 4 dias</th>` após ROI; `<td>` correspondente (`—` se `d4` null).

### Task 4: Validação
- [ ] `node server.js` no worktree; dev-browser: login, aba Campanhas, expandir campanha com gasto, print.
- [ ] Conferir 1–2 conjuntos contra `/api/drilldown/...&since=D-3&until=hoje&adsets_only=1` cru.
- [ ] Commit.
