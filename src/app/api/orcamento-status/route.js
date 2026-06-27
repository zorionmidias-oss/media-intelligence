'use strict';
const axios = require('axios');
const { DateTime } = require('luxon');
const supabase = require('../../../lib/supabase');
const { getUSDtoBRL } = require('../../../services/exchange.service');

const BASE = 'https://graph.facebook.com/v19.0';

// Fator de agendamento de uma unidade (campanha/conjunto) para o dia de HOJE,
// avaliado no fuso da conta (que é o dia que o daily_budget da Meta respeita):
//   • sem start_time, ou já rodando (start <= agora) → 1 (orçamento cheio)
//   • começa MAIS TARDE hoje → proporcional: (horas de start até meia-noite) / 24
//   • começa em DIA FUTURO (amanhã+) → 0 (não gasta hoje; entra no dia que ligar)
function startFactor(startIso, accountTz, nowDt) {
  if (!startIso) return 1;
  const s = DateTime.fromISO(startIso).setZone(accountTz);
  if (!s.isValid) return 1;
  const fimDeHoje = nowDt.endOf('day');         // hoje 23:59:59.999 no fuso da conta
  if (s > fimDeHoje) return 0;                   // agendado p/ dia futuro
  if (s <= nowDt) return 1;                      // já começou (ou começa agora)
  const meiaNoite = nowDt.startOf('day').plus({ days: 1 }); // próxima 00:00 = fim de hoje
  const horasRestantes = meiaNoite.diff(s, 'hours').hours;
  return Math.max(0, Math.min(1, horasRestantes / 24));
}

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
      .select('ad_account_id,nome,access_token,moeda,imposto_percentual,timezone_name')
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
      let pausadosComGasto = 0;   // conjuntos/campanhas desativados que já gastaram hoje
      let agendadosFuturos = 0;   // unidades ativas porém programadas p/ dia futuro (fator 0)
      let parciaisHoje = 0;       // unidades que começam mais tarde hoje (0 < fator < 1)

      // "Hoje" e "agora" no fuso da conta — é o dia que o daily_budget da Meta respeita
      const accountTz = acc.timezone_name || 'America/Sao_Paulo';
      const nowDt = DateTime.now().setZone(accountTz);
      const hojeLocal = nowDt.toISODate();

      try {
        // Orçamentos das unidades ATIVAS + gasto de HOJE por conjunto (account currency).
        // O gasto de hoje serve para: (a) precisar unidades ativas que já passaram do budget
        // (budget reduzido no meio do dia) e (b) contabilizar unidades DESATIVADAS ao longo
        // do dia pelo que efetivamente vão gastar (= o que já gastaram, pois estão off).
        // start_time entra no cálculo do fator de agendamento (ver startFactor).
        const [campaigns, adsets, insights] = await Promise.all([
          metaPaginado(`${BASE}/${accountId}/campaigns`, {
            effective_status: JSON.stringify(['ACTIVE']),
            fields: 'id,daily_budget,start_time',
            limit: 200,
            access_token: acc.access_token,
          }),
          metaPaginado(`${BASE}/${accountId}/adsets`, {
            effective_status: JSON.stringify(['ACTIVE']),
            fields: 'id,campaign_id,daily_budget,start_time',
            limit: 500,
            access_token: acc.access_token,
          }),
          // Gasto de hoje por conjunto (sem actions/breakdown → não esbarra no throttle 1504038)
          metaPaginado(`${BASE}/${accountId}/insights`, {
            level: 'adset',
            time_range: JSON.stringify({ since: hojeLocal, until: hojeLocal }),
            fields: 'adset_id,campaign_id,spend',
            limit: 500,
            access_token: acc.access_token,
          }),
        ]);

        campanhasAtivas = campaigns.length;
        adsetsAtivos = adsets.length;

        // Gasto de hoje (moeda da conta) indexado por conjunto e por campanha
        const spendByAdset = {};
        const spendByCamp = {};
        const campOfAdset = {};
        for (const r of insights) {
          const sp = Number(r.spend || 0);
          if (r.adset_id) {
            spendByAdset[r.adset_id] = (spendByAdset[r.adset_id] || 0) + sp;
            if (r.campaign_id) campOfAdset[r.adset_id] = r.campaign_id;
          }
          if (r.campaign_id) spendByCamp[r.campaign_id] = (spendByCamp[r.campaign_id] || 0) + sp;
        }

        // Agrupar adsets ativos por campaign_id para lógica ABO
        const adsetsByCamp = {};
        const activeAdsetIds = new Set();
        for (const a of adsets) {
          activeAdsetIds.add(a.id);
          if (!adsetsByCamp[a.campaign_id]) adsetsByCamp[a.campaign_id] = [];
          adsetsByCamp[a.campaign_id].push(a);
        }

        // Orçamento previsto da conta, em moeda da conta (converte p/ BRL no fim)
        let orcamentoContaOrig = 0;
        const cboAtivasIds = new Set();

        // Contabiliza o fator de agendamento p/ telemetria (sem dupla contagem por unidade)
        const contaFator = (f) => {
          if (f <= 0) agendadosFuturos++;
          else if (f < 1) parciaisHoje++;
        };

        for (const camp of campaigns) {
          const campBudget = Number(camp.daily_budget || 0) / 100;
          const childAdsets = adsetsByCamp[camp.id] || [];
          if (campBudget > 0) {
            // CBO ativa: vai gastar até o budget; se já passou (budget reduzido), usa o gasto.
            // Fator da campanha = quando o 1º conjunto liga (maior fator entre os conjuntos);
            // sem conjuntos ativos, usa o start_time da própria campanha.
            cboAtivasIds.add(camp.id);
            const fator = childAdsets.length
              ? Math.max(...childAdsets.map(a => startFactor(a.start_time, accountTz, nowDt)))
              : startFactor(camp.start_time, accountTz, nowDt);
            contaFator(fator);
            orcamentoContaOrig += Math.max(campBudget * fator, spendByCamp[camp.id] || 0);
            cboCont++;
          } else {
            // ABO: cada conjunto ativo gasta até seu budget × fator (ou o que já gastou, se maior)
            for (const a of childAdsets) {
              const b = Number(a.daily_budget || 0) / 100;
              const fator = startFactor(a.start_time, accountTz, nowDt);
              contaFator(fator);
              orcamentoContaOrig += Math.max(b * fator, spendByAdset[a.id] || 0);
            }
            aboCont++;
          }
        }

        // Unidades DESATIVADAS ao longo do dia que já gastaram: contam pelo gasto realizado
        // (estão off → não gastam mais). Pula o que já foi coberto por unidade ativa,
        // evitando dupla contagem (CBO ativa cobre seus conjuntos; ABO ativo já contado).
        for (const adsetId in spendByAdset) {
          const spent = spendByAdset[adsetId];
          if (spent <= 0) continue;
          const campId = campOfAdset[adsetId];
          if (cboAtivasIds.has(campId)) continue;   // coberto pelo budget da campanha CBO ativa
          if (activeAdsetIds.has(adsetId)) continue; // conjunto ABO ativo, já contado acima
          orcamentoContaOrig += spent;
          pausadosComGasto++;
        }

        orcamentoContaBRL = orcamentoContaOrig * taxa * fatorImposto;

        console.log(
          `[orcamento] ${accountId} tz=${accountTz} moeda=${moeda} taxa=${taxa.toFixed(4)}` +
          ` fatorImp=${fatorImposto.toFixed(4)}` +
          ` camps=${campanhasAtivas} adsets=${adsetsAtivos}` +
          ` CBO=${cboCont} ABO=${aboCont} pausadosComGasto=${pausadosComGasto}` +
          ` agendadosFuturos=${agendadosFuturos} parciaisHoje=${parciaisHoje}` +
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
        pausados_com_gasto: pausadosComGasto,
        agendados_futuros: agendadosFuturos,
        parciais_hoje:     parciaisHoje,
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
