# Funil de Conversão — Visão geral (fatia 1) e por campanha (fatia 2)

Data: 23/11/2026 · Pedido do Kayke · Branch `feat/funil-conversao` · Dash antigo `public/dashboard.html`
Referência visual: `mockups/image.png` (faixa que afina, pílula de % entre etapas, número + rótulo embaixo,
etapa-gargalo em vermelho, seletor ‹ › no canto).

## Objetivo
Ver visualmente onde a operação perde gente, do clique no anúncio até a impressão GAM.

## Etapas (decisão do Kayke, 23/11) e fonte de cada uma
| # | Etapa | Fonte (já no banco do dash, sem dado novo) |
|---|---|---|
| 1 | Cliques | `meta_conjunto.cliques_link` (Meta) |
| 2 | Conversas iniciadas | `funil_conjunto.leads_entrada` — `cid` únicos do bot. O `cid` nasce quando o lead chega pelo anúncio (`engine.ts` ~l.167), **antes** de qualquer link: conta todo lead, recebendo link ou não. Embaixo, pequeno: `meta_conjunto.conversas_meta` como referência (infla ~2,3×). |
| 3 | Cliques no link (página abriu) | `funil_conjunto.leads_com_sessao` — leads únicos com sessão no blog |
| 4 | Visualização de conteúdo | `meta_conjunto.sessoes_meta` (ViewContent do pixel) |
| 5 | Impressões | `receita_ads.impressoes` (GAM, por ad id → conjunto) |

- Passagens 1→2, 2→3, 3→4: **%** (faixa afina). Passagem 4→5: **multiplicador `x`** (≈2,0x), faixa **abre**.
- Rótulo da etapa 3 é honesto: "página abriu". O clique total não existe hoje (Messenger abre o
  `web_url` sem avisar ninguém; o único registro vem do snippet do blog no load).
  **Fora de escopo / projeto futuro:** redirecionador de clique no bot (mexe em todo link do caminho
  de faturamento — só se o funil mostrar buraco suspeito entre etapa 2 e 3).

## Gargalo (vermelho)
- Referência = **mediana das taxas diárias dos 7 dias fechados anteriores ao `since`**, no mesmo
  escopo (geral/domínio ou campanha). Mediana = valor do meio, imune a um dia fora da curva.
- Desvio de cada passagem = taxa_período ÷ mediana_7d. A passagem com **menor desvio < 0,9**
  fica vermelha; as demais em azul. Sem referência (dias sem volume) → nenhuma vermelha.
- Hover na pílula: "normal 7d: 58%".

## Escopo e navegação
- **Fatia 1:** card "Funil de Conversão" na Visão geral, abaixo dos cards principais. Segue
  período + domínio do filtro do topo. Seletor ‹ › percorre **Geral → campanhas por gasto desc**.
- **Fatia 2:** o mesmo componente no expand da campanha em Campanhas (reuso).

## Backend
- `GET /api/funil-conversao?since&until&domain` (requireAuth + catálogo `permissions.js`, leitura
  na mesma permissão de `/api/dashboard`). Reusa `buscarLinhas` de `src/app/api/diagnostico/route.js`
  (exportada), janela `[since−7, until]`, RBAC `req.allowedDominios` igual ao diagnóstico.
- Resposta: `{ geral: Funil, campanhas: Funil[] }`, `Funil = { campaign_id?, nome, gasto,
  etapas: {cliques, conversas, conversas_meta, pagina_abriu, vc, imp_gam}, ref: {t12,t23,t34,x45} }`.
  Soma antes de dividir (nunca média de taxas).

## Impacto no banco
- 1 leitura de 3 tabelas existentes (`meta_conjunto`, `funil_conjunto`, `receita_ads`) por abertura
  da Visão geral / troca de filtro; janela período+7d; centenas de linhas/dia; índice por `data` já existe.
- É a mesma consulta que as colunas de fator faziam (removidas hoje) → custo líquido igual ao de ontem.
- Sem tabela/índice novo, sem crescimento. Aguenta 10× sem mudança.

## Validação
Servidor local (sem scheduler) + login do Kayke; conferir Geral e 1 campanha contra soma direta
das tabelas no período; print para o Kayke antes de subir.
