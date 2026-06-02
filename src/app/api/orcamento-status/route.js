'use strict';
const axios = require('axios');
const supabase = require('../../../lib/supabase');
const { getUSDtoBRL } = require('../../../services/exchange.service');

const BASE = 'https://graph.facebook.com/v19.0';

// Paginação automática para endpoints Meta que retornam cursor-based paging
async function metaPaginado(url, params) {
  const items = [];
  let nextUrl = url;
  let reqParams = params;
  while (nextUrl) {
    const r = await axios.get(nextUrl, { params: reqParams, timeout: 20000 });
    items.push(...(r.data?.data || []));
    nextUrl = r.data?.paging?.next || null;
    reqParams = {};
  }
  return items;
}

async function handler(req, res) {
  try {
    const now = new Date();
    const hoje = now.toISOString().slice(0, 10);
    const since = req.query.since || hoje;
    const until  = req.query.until  || hoje;

    const dias = Math.round((new Date(until) - new Date(since)) / 86400000) + 1;

    // Taxa USD→BRL ao vivo para converter orçamentos
    const taxaUSD = await getUSDtoBRL();

    // Contas ativas com token, moeda, imposto e nome
    const { data: accounts } = await supabase
      .from('meta_accounts')
      .select('ad_account_id,nome,access_token,moeda,imposto_percentual')
      .eq('ativo', true);

    let orcamentoHoje = 0;
    const porConta = [];

    for (const acc of accounts || []) {
      if (!acc.access_token) continue;
      const accountId = String(acc.ad_account_id).startsWith('act_')
        ? String(acc.ad_account_id)
        : `act_${acc.ad_account_id}`;
      const moeda = acc.moeda || 'BRL';
      const taxa = moeda === 'USD' ? taxaUSD : 1;
      const fatorImposto = 1 + (Number(acc.imposto_percentual || 0) / 100);

      let orcamentoContaBRL = 0;
      let campanhasAtivas = 0;
      let adsetsAtivos = 0;
      let cboCont = 0;
      let aboCont = 0;

      try {
        const [campaigns, adsets] = await Promise.all([
          metaPaginado(`${BASE}/${accountId}/campaigns`, {
            effective_status: JSON.stringify(['ACTIVE']),
            fields: 'id,daily_budget',
            limit: 200,
            access_token: acc.access_token,
          }),
          metaPaginado(`${BASE}/${accountId}/adsets`, {
            effective_status: JSON.stringify(['ACTIVE']),
            fields: 'id,campaign_id,daily_budget',
            limit: 500,
            access_token: acc.access_token,
          }),
        ]);

        campanhasAtivas = campaigns.length;
        adsetsAtivos = adsets.length;

        // Agrupar adsets por campaign_id para lógica ABO
        const adsetsByCamp = {};
        for (const a of adsets) {
          if (!adsetsByCamp[a.campaign_id]) adsetsByCamp[a.campaign_id] = [];
          adsetsByCamp[a.campaign_id].push(a);
        }

        for (const camp of campaigns) {
          const campBudgetCents = Number(camp.daily_budget || 0);
          let budgetCents = 0;
          if (campBudgetCents > 0) {
            // CBO: orçamento na campanha
            budgetCents = campBudgetCents;
            cboCont++;
          } else {
            // ABO: somar daily_budget dos adsets ativos desta campanha
            budgetCents = (adsetsByCamp[camp.id] || [])
              .reduce((s, a) => s + Number(a.daily_budget || 0), 0);
            aboCont++;
          }
          orcamentoContaBRL += (budgetCents / 100) * taxa * fatorImposto;
        }

        console.log(
          `[orcamento] ${accountId} moeda=${moeda} taxa=${taxa.toFixed(4)}` +
          ` fatorImp=${fatorImposto.toFixed(4)}` +
          ` camps=${campanhasAtivas} adsets=${adsetsAtivos}` +
          ` CBO=${cboCont} ABO=${aboCont}` +
          ` orcBRL=${orcamentoContaBRL.toFixed(2)}`
        );
      } catch (e) {
        console.warn(`[orcamento] ${accountId}:`, e.response?.data?.error?.message || e.message);
      }

      const modo = campanhasAtivas === 0 ? 'vazio'
        : cboCont > 0 && aboCont === 0 ? 'CBO'
        : cboCont === 0 && aboCont > 0  ? 'ABO'
        : 'misto';

      porConta.push({
        ad_account_id:    acc.ad_account_id,
        nome:             acc.nome || acc.ad_account_id,
        moeda,
        taxa_usd:         moeda === 'USD' ? +taxaUSD.toFixed(4) : null,
        imposto_pct:      Number(acc.imposto_percentual || 0),
        orcamento_hoje_brl: +orcamentoContaBRL.toFixed(2),
        campanhas_ativas: campanhasAtivas,
        adsets_ativos:    adsetsAtivos,
        modo,
      });

    }

    // Somar os valores JÁ arredondados por conta — garante que sum(por_conta[].orcamento_hoje_brl) === hoje.orcamento
    orcamentoHoje = porConta.reduce((s, c) => s + c.orcamento_hoje_brl, 0);

    // USADO: soma de valor_gasto hoje e no período (já em BRL c/ imposto)
    // v1: account-level — não aplica filtro de domínio intencionalmente
    // TODO v2: adicionar filtro por domínio via prefixo de campanha
    const { data: rowsHoje } = await supabase
      .from('ads_consolidados')
      .select('valor_gasto')
      .eq('data', hoje);

    const { data: rowsPeriodo } = await supabase
      .from('ads_consolidados')
      .select('valor_gasto')
      .gte('data', since)
      .lte('data', until);

    const usadoHoje    = (rowsHoje   || []).reduce((s, r) => s + Number(r.valor_gasto || 0), 0);
    const usadoPeriodo = (rowsPeriodo || []).reduce((s, r) => s + Number(r.valor_gasto || 0), 0);

    const orcamentoPeriodo = orcamentoHoje * dias;

    res.json({
      hoje: {
        orcamento: +orcamentoHoje.toFixed(2),
        usado:     +usadoHoje.toFixed(2),
        falta:     +(orcamentoHoje - usadoHoje).toFixed(2),
      },
      periodo: {
        orcamento:          +orcamentoPeriodo.toFixed(2),
        usado:              +usadoPeriodo.toFixed(2),
        falta:              +(orcamentoPeriodo - usadoPeriodo).toFixed(2),
        dias,
        orcamento_estimado: true,
      },
      por_conta: porConta,
    });
  } catch (err) {
    console.error('[orcamento-status]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
