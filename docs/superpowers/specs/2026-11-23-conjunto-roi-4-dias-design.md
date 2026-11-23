# ROI dos últimos 4 dias por conjunto — dashboard atual (`dashboard.html`)

Data: 23/11/2026 · Pedido do Kayke · Branch `feat/conjunto-roi-4d` (a partir de `origin/main`)

## Objetivo
Trazer para o dashboard em uso (`public/dashboard.html`, aba Campanhas → expandir ▶
conjuntos) o histórico de ROI dos últimos 4 dias por conjunto que existe no redesign
React (`/app`, `frontend/src/pages/campanhas/ConjuntosDetail.jsx`, commit 6844874).
O `/app` não é tocado.

## Decisões (Kayke, 23/11)
1. **Janela fixa:** sempre hoje + 3 dias anteriores (fuso São Paulo, `hojeBR()`),
   independente do período do filtro. (O `/app` usa os últimos 4 dias *do período*
   — aqui é diferente de propósito.)
2. **Unidade:** multiplicador (`1.25x`), igual à coluna ROI ao lado. Cores =
   `corROI`: verde ≥1.2x · amarelo ≥1x · vermelho <1x.
3. **Hoje parcial:** a coluna de hoje fica esmaecida com dica "parcial — dia em andamento".

## Desenho
- Nova coluna **"ROI · 4 dias"** logo após "ROI" na tabela `.ud-table` do expand inline.
- Por conjunto: 4 slots fixos (D-3 … hoje), cada um com valor `x`, mini-barra
  proporcional (altura relativa ao maior |ROI−1| dos 4) e data `DD/MM`.
- Dia sem gasto (fora de `roi_serie`) → `—` no slot (mantém 4 posições alinhadas).

## Dados (sem mudança de backend)
- `toggleUtmExpand` dispara em paralelo à chamada atual uma segunda chamada ao mesmo
  `/api/drilldown/:utm?adsets_only=1&campaign_id=…` com `since=hoje-3`, `until=hoje`.
- `roi_serie[]` de cada conjunto (`{data, roi}` com ROI% = (rec_liq − gasto)÷gasto×100,
  receita líquida ×0.9, gasto convertido pelo fator BRL) → multiplicador = `1 + roi/100`.
  Mesma conta do `/app`; nenhuma invariante de receita/gasto/fuso alterada.
- Junção por `adset_id`. Conjunto do período sem entrada na janela → 4× `—`.
- Falha da chamada dos 4 dias → tabela renderiza normal, coluna com `—` (não bloqueia).

## Impacto
- +1 chamada Meta Insights por expand (cache de 60s por `campaign_id:since:until:a`).
  Zero query/tabela nova no Supabase além das que o drilldown já faz.

## Fora de escopo
Coluna "Tendência" do `/app`; funil cliques→bot→link→monetizado (próximo projeto).

## Validação
Servidor local + navegador automatizado: expandir campanha real, print, conferir 1–2
conjuntos (valores dos 4 dias) contra a resposta crua do `/api/drilldown` da janela.
