# Export por conjunto de anúncio

Dados por **conjunto de anúncio (adset_id) × dia**, cruzando as 4 fontes que o analista pediud:
Meta Ads, Bot/Messenger, Blog/Analytics e GAM. Janela padrão: **2026-07-22 → hoje**.

Chave de tudo: `adset_id`. Nomes (`adset_name`, `campaign_name`) são só rótulo.

## Arquivos

| Arquivo | Grão | Fonte |
|---|---|---|
| **MASTER_por_conjunto.csv** | conjunto × dia | junção de todos abaixo — **use este** |
| meta_por_conjunto.csv | conjunto × dia | Meta Insights fresco (`level=adset`) |
| gam_por_conjunto.csv | conjunto × dia | `receita_ads` (dashboard) |
| bot_blog_por_conjunto.csv | conjunto × dia | projeto trakeamento (`ad_clicks`+`lead_qualifications`+`blog_sessions`) |
| gam_inventario.csv | **bloco × dia** | `blocos_anuncio` — inventário, NÃO por conjunto (ver gap 5) |

## Colunas do MASTER

- **Identidade:** data, conta, campaign_id, campaign_name, adset_id, adset_name
- **Meta:** gasto, impressoes_meta, alcance, frequencia, cpm, cliques_link, ctr_link, cpc_link, conversas, custo_conversa, status_atual, orcamento_diario_atual
- **Bot:** leads_entrada (cid únicos), cliques_ad, threads, leads_qualificados, leads_avaliados, receita_estimada_brl
- **Blog:** sessoes, leads_com_sessao, gap_clique_sessao, pct_chegada_blog, sessoes_por_lead, taxa_qualificacao
- **GAM:** receita_gam_bruta, receita_gam_liquida (= bruta × 0.9), impressoes_gam, cliques_gam, ecpm_gam

## Leia antes de analisar

1. **Moeda.** `gasto` está na **moeda da conta** (USD nas contas USD, BRL na conta BRL — ver coluna `conta`).
   `receita_gam_*` e `receita_estimada_brl` estão em **BRL**. Por isso **não** há coluna de lucro:
   converta o gasto USD→BRL antes de subtrair.

2. **Âncora de dia difere por fonte** (por design):
   - Meta → dia do anúncio; Bot → dia do clique (`captured_at`); Blog → dia da sessão (`occurred_at`);
     GAM → dia da receita. Um lead clica no dia X e gera sessão/receita nos dias X…X+3.
     Para ROI por conjunto isso importa: alinhe pela janela, não linha a linha.

3. **`gap_clique_sessao`** = leads_entrada − leads_com_sessao = o vazamento clique→blog
   (suspeito clássico: navegador in-app do Messenger no Android). `pct_chegada_blog` mede o mesmo em %.

## Gaps conhecidos (o que NÃO está aqui e por quê)

1. **Conta Meta "EMPREGO USD"** veio zerada na janela — sem entrega no período (não é erro de extração).
2. **status_atual / orcamento_diario_atual** são **snapshot de agora**, não histórico por dia
   (a Meta Insights não devolve orçamento/entrega retroativos). Para "detectar mudança de escala"
   histórica seria preciso capturar diariamente daqui pra frente.
3. **Blog — país e navegador/SO:** `blog_sessions.geo` está **nulo** hoje (país do blog indisponível);
   navegador/SO não são coletados. `device` existe e dá pra adicionar por conjunto se quiser.
4. **lead_qualifications só vai até 2026-08-12** — `leads_qualificados`, `leads_avaliados` e
   `receita_estimada_brl` zeram depois dessa data (o job de qualificação parou de gravar; verificar).
5. **GAM inventário (solicitações / fill rate / Active View viewability):** são métricas de
   **inventário** — acontecem no carregamento da página do blog, independentemente do conjunto Meta
   que trouxe o usuário. **Não são atribuíveis por conjunto.** O que dá é nível bloco/dia
   (`gam_inventario.csv`, com taxa de correspondência programática como proxy de fill). A `viewability`
   existe em `ads_consolidados` mas é a da rede/domínio (constante ~87,5%), não por conjunto — por isso
   fora do master. "Ad requests" e "unfilled" reais exigem um relatório GAM dedicado (Active View) —
   dá pra adicionar se necessário.
6. **Bot — nível de card do fluxo** (drop-off por card, cliques por card, URL de destino, versão do
   fluxo): **não vive em nenhum banco** — mora na ferramenta própria de vocês. Pendente do acesso
   prometido para integrar.

## Como reexecutar / atualizar

```powershell
# Meta (fresco) + GAM por conjunto  — usa .env.local (dashboard + Meta + GAM)
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/export-por-conjunto.js [SINCE] [UNTIL]

# GAM inventário (nível bloco)
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/export-gam-inventario.js [SINCE] [UNTIL]

# Bot + blog: hoje gerado via MCP no projeto de trakeamento (ybiibmvpmzmgfsmlrmjb).
#   Para automatizar num script local, adicionar ao .env.local:
#     TRAKEAMENTO_SUPABASE_URL / TRAKEAMENTO_SERVICE_ROLE_KEY

# Junta tudo no master
node scripts/merge-conjunto.js
```
