'use strict';
// Cálculo do "Orçamento do dia" a partir dos dados AO VIVO da Meta.
// Compartilhado entre a rota /api/orcamento-status (KPI no dashboard) e o
// scheduler (gera notificações de conjunto ativo sem gastar).
//
// Regras (ver CLAUDE.md p/ invariantes de moeda/imposto):
//   • Tudo é avaliado no FUSO DA CONTA (timezone_name) — é o dia que o
//     daily_budget da Meta de fato respeita (contas USD = America/Los_Angeles).
//   • Conversão p/ BRL: valor × (USD?taxa:1) × (1 + imposto%), igual valor_gasto.
//   • Agendamento (start_time): dia futuro → não conta hoje; começa mais tarde
//     hoje → proporcional às horas restantes; já rodando → cheio.
//   • Unidade ATIVA há ≥ STALL_HORAS sem NENHUM gasto (R$0) → "travada":
//     sai do orçamento (não vai gastar) e entra na lista p/ notificação.
//   • Unidade DESATIVADA durante o dia que já gastou → conta pelo gasto realizado.
const axios = require('axios');
const { DateTime } = require('luxon');
const supabase = require('./supabase');
const { getUSDtoBRL } = require('../services/exchange.service');
const { extractDomainPrefix } = require('./parser');

const BASE = 'https://graph.facebook.com/v19.0';

// Conjunto/campanha ATIVO por ≥ 3h com R$0 gasto é considerado travado.
const STALL_HORAS = 3;

// Fator de agendamento p/ o dia de HOJE no fuso da conta.
function startFactor(startIso, nowDt) {
  if (!startIso) return 1;
  const s = DateTime.fromISO(startIso).setZone(nowDt.zoneName);
  if (!s.isValid) return 1;
  const fimDeHoje = nowDt.endOf('day');
  if (s > fimDeHoje) return 0;                   // agendado p/ dia futuro
  if (s <= nowDt) return 1;                      // já começou (ou começa agora)
  const meiaNoite = nowDt.startOf('day').plus({ days: 1 });
  const horasRestantes = meiaNoite.diff(s, 'hours').hours;
  return Math.max(0, Math.min(1, horasRestantes / 24));
}

// Horas que a unidade já esteve ELEGÍVEL p/ rodar hoje (start → agora, no dia).
// Sem start_time (ou começou antes de hoje) → desde a meia-noite local.
function horasAtivasHoje(startIso, nowDt) {
  const inicioDia = nowDt.startOf('day');
  let efetivo = inicioDia;
  if (startIso) {
    const s = DateTime.fromISO(startIso).setZone(nowDt.zoneName);
    if (s.isValid && s > inicioDia) efetivo = s;   // começou hoje mais tarde
  }
  if (efetivo > nowDt) return 0;                   // ainda não começou
  return nowDt.diff(efetivo, 'hours').hours;
}

// Paginação automática para endpoints Meta (cursor-based).
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

// Calcula o orçamento de HOJE por conta + lista de conjuntos travados (sem gasto).
// opts.prefixoFiltro (uppercase): se setado, conta só campanhas cujo prefixo do
// nome (1º [...]) bate com o domínio selecionado. Sem filtro = todas as contas.
// Retorna { orcamentoHoje, porConta, stalled }.
async function computeOrcamentoContas(opts = {}) {
  const prefixoFiltro = opts.prefixoFiltro ? String(opts.prefixoFiltro).toUpperCase() : null;
  // Casa o nome da campanha com o domínio selecionado (mesma regra do sync)
  const matchDominio = (campaignName) =>
    !prefixoFiltro || (extractDomainPrefix(campaignName) || '').toUpperCase() === prefixoFiltro;

  const taxaUSD = await getUSDtoBRL();

  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('ad_account_id,nome,access_token,moeda,imposto_percentual,timezone_name')
    .eq('ativo', true);

  const porConta = [];
  const stalled = [];

  for (const acc of accounts || []) {
    if (!acc.access_token) continue;
    const accountId = String(acc.ad_account_id).startsWith('act_')
      ? String(acc.ad_account_id)
      : `act_${acc.ad_account_id}`;
    const moeda = acc.moeda || 'BRL';
    const taxa = moeda === 'USD' ? taxaUSD : 1;
    const fatorImposto = 1 + (Number(acc.imposto_percentual || 0) / 100);
    const paraBRL = (v) => v * taxa * fatorImposto;

    let orcamentoContaBRL = 0;
    let campanhasAtivas = 0;
    let adsetsAtivos = 0;
    let cboCont = 0;
    let aboCont = 0;
    let pausadosComGasto = 0;
    let agendadosFuturos = 0;
    let parciaisHoje = 0;
    let semGasto = 0;

    // "Hoje"/"agora" no fuso da conta — dia que o daily_budget respeita
    const accountTz = acc.timezone_name || 'America/Sao_Paulo';
    const nowDt = DateTime.now().setZone(accountTz);
    const hojeLocal = nowDt.toISODate();

    try {
      const [campaigns, adsets, insights] = await Promise.all([
        metaPaginado(`${BASE}/${accountId}/campaigns`, {
          effective_status: JSON.stringify(['ACTIVE']),
          fields: 'id,name,daily_budget,start_time',
          limit: 200,
          access_token: acc.access_token,
        }),
        metaPaginado(`${BASE}/${accountId}/adsets`, {
          effective_status: JSON.stringify(['ACTIVE']),
          fields: 'id,name,campaign_id,daily_budget,start_time',
          limit: 500,
          access_token: acc.access_token,
        }),
        // Gasto de hoje por conjunto (sem actions/breakdown → não esbarra no throttle 1504038)
        metaPaginado(`${BASE}/${accountId}/insights`, {
          level: 'adset',
          time_range: JSON.stringify({ since: hojeLocal, until: hojeLocal }),
          fields: 'adset_id,campaign_id,campaign_name,spend',
          limit: 500,
          access_token: acc.access_token,
        }),
      ]);

      campanhasAtivas = campaigns.length;
      adsetsAtivos = adsets.length;

      const spendByAdset = {};
      const spendByCamp = {};
      const campOfAdset = {};
      const campNameOfAdset = {};   // p/ resolver domínio de unidades pausadas
      for (const r of insights) {
        const sp = Number(r.spend || 0);
        if (r.adset_id) {
          spendByAdset[r.adset_id] = (spendByAdset[r.adset_id] || 0) + sp;
          if (r.campaign_id) campOfAdset[r.adset_id] = r.campaign_id;
          if (r.campaign_name) campNameOfAdset[r.adset_id] = r.campaign_name;
        }
        if (r.campaign_id) spendByCamp[r.campaign_id] = (spendByCamp[r.campaign_id] || 0) + sp;
      }

      const adsetsByCamp = {};
      const activeAdsetIds = new Set();
      const campNome = {};
      for (const c of campaigns) campNome[c.id] = c.name || c.id;
      for (const a of adsets) {
        activeAdsetIds.add(a.id);
        if (!adsetsByCamp[a.campaign_id]) adsetsByCamp[a.campaign_id] = [];
        adsetsByCamp[a.campaign_id].push(a);
      }

      let orcamentoContaOrig = 0;
      const cboAtivasIds = new Set();
      const contaFator = (f) => { if (f <= 0) agendadosFuturos++; else if (f < 1) parciaisHoje++; };

      // Registra uma unidade travada (ativa há ≥ STALL_HORAS sem gasto)
      const pushStalled = (nivel, id, nome, campaignId, horas, budgetOrig) => {
        semGasto++;
        stalled.push({
          account_id: acc.ad_account_id,
          account_nome: acc.nome || acc.ad_account_id,
          nivel,                                   // 'adset' | 'campaign'
          id,
          nome,
          campaign_id: campaignId,
          campaign_nome: campNome[campaignId] || null,
          horas_ativo: +horas.toFixed(1),
          budget_brl: +paraBRL(budgetOrig).toFixed(2),
        });
      };

      for (const camp of campaigns) {
        if (!matchDominio(camp.name)) continue;   // fora do domínio filtrado
        const campBudget = Number(camp.daily_budget || 0) / 100;
        const childAdsets = adsetsByCamp[camp.id] || [];
        if (campBudget > 0) {
          // CBO ativa
          cboAtivasIds.add(camp.id);
          cboCont++;
          const fator = childAdsets.length
            ? Math.max(...childAdsets.map(a => startFactor(a.start_time, nowDt)))
            : startFactor(camp.start_time, nowDt);
          contaFator(fator);
          const campSpent = spendByCamp[camp.id] || 0;
          const horas = childAdsets.length
            ? Math.max(...childAdsets.map(a => horasAtivasHoje(a.start_time, nowDt)))
            : horasAtivasHoje(camp.start_time, nowDt);
          if (campSpent === 0 && horas >= STALL_HORAS) {
            // Campanha travada: ativa há horas e R$0 gasto → não conta no orçamento
            pushStalled('campaign', camp.id, camp.name || camp.id, camp.id, horas, campBudget);
          } else {
            orcamentoContaOrig += Math.max(campBudget * fator, campSpent);
          }
        } else {
          // ABO
          aboCont++;
          for (const a of childAdsets) {
            const b = Number(a.daily_budget || 0) / 100;
            const fator = startFactor(a.start_time, nowDt);
            contaFator(fator);
            const spent = spendByAdset[a.id] || 0;
            const horas = horasAtivasHoje(a.start_time, nowDt);
            if (spent === 0 && horas >= STALL_HORAS) {
              // Conjunto travado: ativo há horas e R$0 gasto → não conta no orçamento
              pushStalled('adset', a.id, a.name || a.id, a.campaign_id, horas, b);
            } else {
              orcamentoContaOrig += Math.max(b * fator, spent);
            }
          }
        }
      }

      // Unidades DESATIVADAS durante o dia que já gastaram → contam pelo gasto realizado
      for (const adsetId in spendByAdset) {
        const spent = spendByAdset[adsetId];
        if (spent <= 0) continue;
        const campId = campOfAdset[adsetId];
        if (cboAtivasIds.has(campId)) continue;   // coberto pelo budget da CBO ativa
        if (activeAdsetIds.has(adsetId)) continue; // conjunto ABO ativo, já contado
        if (!matchDominio(campNameOfAdset[adsetId])) continue; // fora do domínio filtrado
        orcamentoContaOrig += spent;
        pausadosComGasto++;
      }

      orcamentoContaBRL = paraBRL(orcamentoContaOrig);

      console.log(
        `[orcamento] ${accountId} tz=${accountTz} moeda=${moeda} taxa=${taxa.toFixed(4)}` +
        ` fatorImp=${fatorImposto.toFixed(4)} camps=${campanhasAtivas} adsets=${adsetsAtivos}` +
        ` CBO=${cboCont} ABO=${aboCont} pausadosComGasto=${pausadosComGasto}` +
        ` agendadosFuturos=${agendadosFuturos} parciaisHoje=${parciaisHoje}` +
        ` semGasto=${semGasto} orcBRL=${orcamentoContaBRL.toFixed(2)}`
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
      conjuntos_sem_gasto: semGasto,
      modo,
    });
  }

  const orcamentoHoje = porConta.reduce((s, c) => s + c.orcamento_hoje_brl, 0);
  return { orcamentoHoje, porConta, stalled };
}

module.exports = { computeOrcamentoContas, STALL_HORAS };
