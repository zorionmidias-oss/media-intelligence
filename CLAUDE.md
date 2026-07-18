# Media Intelligence — 2Junior's

Dashboard de arbitragem de tráfego: compra mídia na Meta (Facebook Ads) que leva a sites monetizados com Google Ad Manager (GAM). Lucro = receita GAM líquida − gasto Meta. Single-tenant, deploy no Render (auto-deploy no push para `main`).

## Rodar

- `node server.js` — Express na porta 3000, serve `public/` e inicia o scheduler (sync a cada 30min + diário 06h).
- Env em `.env.local` (carregado pelo server via `dotenv.config({path:'.env.local'})`). Para scripts avulsos: `$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config script.js`.
- Sem testes automatizados. Validação = scripts de diagnóstico em `scripts/` e queries read-only no Supabase.

## Arquitetura (fluxo de dados)

```
Meta Insights API ─┐
                   ├─ src/lib/sync.js (syncAll) ─→ Supabase (ads_consolidados, receita_ads,
GAM SOAP Reports ──┘                                meta_entidades, blocos_anuncio, dados_hora,
                                                    report_*, sync_log)
                                                      ↓
                    src/app/api/*/route.js (handlers Express, registrados em server.js)
                                                      ↓
                    public/dashboard.html (monólito ~500KB: HTML+CSS+JS inline)
                    public/mobile.html (versão mobile reduzida)
```

### Cruzamento por id (jul/2026 — regra de ouro)

**Chave de cruzamento é SEMPRE id da Meta; nome é só rótulo de exibição.** A cadeia
`ad_id → adset_id → campaign_id → page_id` fica na dimensão `meta_entidades`
(upsert a cada sync; `page_id` resolvido incrementalmente via batch `?ids=`).
`utm_campaign` do site carrega o ad_id → receita GAM casa por id exato (`receita_ads`,
com `campaign_id`/`page_id`). A aba Campanhas agrupa por `campaign_id` (linhas sem
carimbo = histórico "·legado", agregado por nome); o drilldown com `?campaign_id=`
busca `/{campaign_id}/ads` direto (sem filtro CONTAIN por nome). Duas páginas com
anúncios homônimos (ex.: khanyisafb em 4 campanhas) NUNCA se misturam por design.
`ads_consolidados.gam_match` ('id'|'nome'|'id+nome'|null) audita como cada linha casou.
Backfill de histórico: `scripts/backfill-meta-entidades.js`.

- `server.js` — todas as rotas; `requireAuth` (JWT em cookie) em tudo exceto `/api/auth/*`, `/health`, `/privacidade`.
- `src/lib/sync.js` — coração do sistema. Busca Meta ads + GAM, consolida por UTM e grava.
- `src/lib/gam.js` — relatórios GAM via SOAP (job → poll → CSV). `CUSTOM_CRITERIA` carrega utm_campaign/utm_medium/utm_source.
- `src/lib/parser.js` — extrai UTM/país/nicho dos nomes de campanha/anúncio Meta. Convenções: campanha `[PREFIXO] [PAIS_NICHO_IDIOMA_TIPO_NNNN] [PAGINA]`, anúncio `01-nomefb` → UTM `nomefb`.
- `src/services/exchange.service.js` — taxa USD→BRL com cache em `taxas_cambio` por data.

## Invariantes de negócio (NÃO violar)

- **Receita líquida = bruta GAM × 0.9** — aplicado UMA vez no sync (`faturamento_real`) e na rota overview para `blocos_anuncio`. Nunca reaplicar no frontend.
- **valor_gasto = spend × taxa_usd(data) × (1 + imposto/100)** — contas USD convertem pela taxa do dia; imposto por conta em `meta_accounts.imposto_percentual`. `valor_gasto_original` guarda o valor na moeda da conta; `taxa_usd_aplicada` guarda a taxa usada.
- **orcamento_total** também é convertido para BRL com imposto (desde 11/06/2026).
- **Re-bucketing por fuso**: contas Meta em fuso ≠ São Paulo (LA) têm gasto re-bucketed por hora para o dia BR via luxon. Comparações com o Ads Manager divergem por design (lá é dia LA).
- **Upsert key de ads_consolidados**: `data,dominio_id,ad_utm,account_id,pais_sigla`. Linhas com `manually_fixed=true` são puladas pelo sync.
- **Meta API rejeita `actions` + breakdown horário** (400/1504038) em contas grandes — por isso o sync usa 2 queries para contas re-bucketed (métricas horárias sem actions + actions diárias). Ver `fetchInsightsWithDayFallback` (fallback dia a dia, tudo-ou-nada por conta).
- `sync_log.status`: `success` | `partial` (alguma conta Meta falhou — badge amarelo no dashboard) | `error`.
- **"Hoje" é SEMPRE fuso São Paulo** — `src/lib/datas.js` (backend) e `hojeBR()`/`dISO()` (front). NUNCA `new Date().toISOString().slice(0,10)`: é UTC e a partir das 21h BRT vira amanhã. Cron diário tem `timezone: 'America/Sao_Paulo'`.
- **Query de período aberto SEMPRE via `src/lib/fetchAll.js`** — PostgREST corta em 1000 linhas em silêncio (junho/2026: investimento subcontado → ROI 117% falso no Overview).
- **Métricas derivadas SEMPRE via `src/lib/metricas.js`** (breakeven = custo_sessao ÷ rps, <1 saudável; validar com `node scripts/test-metricas.js`). ROI do Overview = visão do negócio (receita TOTAL GAM − gasto); aba Campanhas = receita atribuída por campanha — divergem por design.

## Pegadinhas conhecidas

- `ads_consolidados.conjunto_meta` existe mas NUNCA é preenchido (granularidade da tabela é UTM, não adset) — granularidade por adset vive em `receita_ads`/`meta_entidades`.
- Receita GAM é convertida com a taxa USD **atual** (não por data) em todas as `fetchGAM*` — re-sync de datas antigas reescreve com a taxa de hoje.
- `recalcularContaHistorico` (server.js, rota de imposto) multiplica `valor_gasto_original × fatorImposto` SEM a taxa USD — só é seguro para contas BRL.
- UTMs com typo entre Meta e site quebram matching de receita: ex. `yetudefb`(Meta) vs `yetundefb`(site). Guardrail: alerta `utm_sem_receita` (dia fechado com gasto ≥ R$5 e zero receita casada).
- Planilha Gestão de páginas: match token×linha por prefixo de palavras; token ambíguo (2+ linhas) NÃO escolhe vencedor — zera com aviso na Observação + notificação. Aba definida por `SHEET_GESTAO_ABA` — se renomearem a aba no Sheets, o sync da planilha falha silenciosamente (só loga).
- PowerShell 5.1 no Windows do dev: redirecionar saída cria arquivos UTF-16; usar node para manipular arquivos.

## Tabelas principais (Supabase)

`ads_consolidados` (consolidado diário por UTM+campaign_id), `meta_entidades` (dimensão ad→adset→campanha→página, PK ad_id), `receita_ads` (receita GAM por ad_id/dia — base do ROI por conjunto), `blocos_anuncio` (GAM por ad unit — fonte de verdade de receita), `dados_hora`/`report_hora` (intraday), `meta_accounts` (contas + tokens + imposto/moeda), `dominios` (+`dominios_pendentes`), `metas`, `notificacoes`, `otimizacoes`(+tipos_acao), `historico_campanhas`, `taxas_cambio`, `sync_log`, `usuarios`, `paginas`, `report_utm_campaign/source`.
