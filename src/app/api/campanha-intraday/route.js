'use strict';
// Intraday por CAMPANHA (modal do reloginho na aba Campanhas).
// Meta funnel por hora — investimento, resultado, custo/resultado, conversas, sessões —
// Hoje vs Ontem no fuso BR, agregado por campanha + quebrado por conjunto.
// Rápido (só Meta, sem relatório GAM ao vivo). Cache de 60s por campanha.
const axios = require('axios');
const { DateTime } = require('luxon');
const supabase = require('../../../lib/supabase');
const { getUSDtoBRLByDate } = require('../../../lib/gam');
const { extractTipo } = require('../../../lib/parser');
const { getResultadoMeta, findAction } = require('../../../services/attribution.service');
const { converterHoraParaBR } = require('../../../lib/fuso');

const META_BASE = 'https://graph.facebook.com/v19.0';

const _cache = new Map();
function getCached(k) { const e = _cache.get(k); if (!e) return null; if (Date.now() - e.ts > 60000) { _cache.delete(k); return null; } return e.data; }
function setCache(k, d) { _cache.set(k, { ts: Date.now(), data: d }); }

function spDateHoje() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function spHoraAtual() {
  const s = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
  return parseInt(s.split(':')[0], 10) % 24;
}
function minusDays(iso, d) { const [y, m, dd] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd - d)).toISOString().slice(0, 10); }

// bucket vazio → estrutura de métricas por hora
function emptyHour() { return { investimento: 0, resultado: 0, conversas: 0, sessoes: 0 }; }
// deriva custo/resultado a partir das somas brutas
function finalizeRows(byHora, horaMax) {
  const out = [];
  for (const [horaStr, m] of Object.entries(byHora)) {
    const hora = Number(horaStr);
    if (horaMax != null && hora > horaMax) continue;
    out.push({
      hora,
      investimento:    +m.investimento.toFixed(4),
      resultado:       m.resultado,
      conversas:       m.conversas,
      sessoes:         m.sessoes,
      custo_resultado: m.resultado > 0 ? +(m.investimento / m.resultado).toFixed(4) : null,
    });
  }
  return out.sort((a, b) => a.hora - b.hora);
}

async function handler(req, res) {
  try {
    const campaignId = req.params.campaignId;
    if (!campaignId) return res.status(400).json({ error: 'campaign_id é obrigatório' });

    const cacheKey = `ci:${campaignId}`;
    if (req.query.nocache !== '1') {
      const hit = getCached(cacheKey);
      if (hit) return res.json({ ...hit, _cached: true });
    }

    const dataHoje = spDateHoje();
    const dataOntem = minusDays(dataHoje, 1);
    const horaAtual = spHoraAtual();

    // Conta dona da campanha via meta_entidades (dimensão por id do sync).
    const { data: accounts } = await supabase.from('meta_accounts')
      .select('ad_account_id,access_token,moeda,imposto_percentual,timezone_name').eq('ativo', true);
    const { data: ent } = await supabase.from('meta_entidades')
      .select('account_id').eq('campaign_id', campaignId).not('account_id', 'is', null).limit(1).maybeSingle();
    const acc = (accounts || []).find(a => {
      const k = String(a.ad_account_id).startsWith('act_') ? String(a.ad_account_id) : `act_${a.ad_account_id}`;
      return k === ent?.account_id;
    });
    if (!acc) return res.status(404).json({ error: 'Campanha sem conta na dimensão (meta_entidades)' });

    const token = acc.access_token;
    const acctTz = acc.timezone_name || 'America/Sao_Paulo';
    const rebucket = acctTz !== 'America/Sao_Paulo';
    const moeda = (acc.moeda || 'BRL').toUpperCase();
    const fatorImposto = 1 + (Number(acc.imposto_percentual || 0) / 100);

    // Janela pedida à Meta: ontem BR..hoje BR; contas ≠ SP alargam 1 dia atrás.
    const sinceReq = rebucket ? minusDays(dataOntem, 1) : dataOntem;
    const untilReq = dataHoje;

    // Taxa USD por data (cache) — usa a taxa do dia da linha (BR).
    const rateCache = {};
    const rateFor = async (isoBR) => {
      if (moeda !== 'USD') return 1;
      if (rateCache[isoBR] == null) rateCache[isoBR] = await getUSDtoBRLByDate(isoBR).catch(() => 1);
      return rateCache[isoBR];
    };

    // Uma chamada: nível ADSET, breakdown horário. Dá conjunto × dia × hora.
    let rows = [];
    try {
      let nextUrl = `${META_BASE}/${campaignId}/insights`;
      let params = {
        access_token: token,
        level: 'adset',
        fields: 'adset_id,adset_name,campaign_name,objective,spend,clicks,actions,date_start',
        time_range: JSON.stringify({ since: sinceReq, until: untilReq }),
        time_increment: 1,
        breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
        limit: 500,
      };
      while (nextUrl) {
        const r = await axios.get(nextUrl, { params, timeout: 30000 });
        params = undefined;
        rows = rows.concat(r.data?.data || []);
        nextUrl = r.data?.paging?.next || null;
      }
    } catch (e) {
      return res.status(502).json({ error: 'Meta API: ' + (e.response?.data?.error?.message || e.message) });
    }

    // Agrega: por dia BR → { total: {hora→m}, porConjunto: {adset_id→{nome, {hora→m}}} }
    const dias = { [dataHoje]: { total: {}, conj: {} }, [dataOntem]: { total: {}, conj: {} } };
    const conjNomes = {};

    for (const row of rows) {
      const hField = row.hourly_stats_aggregated_by_advertiser_time_zone || '';
      let dataBR, horaBR;
      if (rebucket) {
        const conv = converterHoraParaBR(row.date_start, hField, acctTz);
        if (!conv) continue;
        dataBR = conv.dataBR; horaBR = conv.horaBR;
      } else {
        dataBR = row.date_start; horaBR = parseInt((hField || '00').slice(0, 2), 10);
      }
      if (dataBR !== dataHoje && dataBR !== dataOntem) continue;

      const rate = await rateFor(dataBR);
      const inv = (Number(row.spend || 0)) * rate * fatorImposto;
      const tipo = extractTipo(row.campaign_name || '');
      const resultado = getResultadoMeta({ actions: row.actions, objective: row.objective }, tipo);
      const conversas = findAction(row.actions, ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_first_reply']);
      const sessoes = findAction(row.actions, ['view_content', 'omni_view_content', 'offsite_conversion.fb_pixel_view_content']);
      if (inv <= 0 && !resultado && !conversas && !sessoes) continue;

      const bucket = dias[dataBR];
      const add = (map, hora) => {
        const m = map[hora] || (map[hora] = emptyHour());
        m.investimento += inv; m.resultado += resultado; m.conversas += conversas; m.sessoes += sessoes;
      };
      add(bucket.total, horaBR);
      const aid = row.adset_id || '?';
      conjNomes[aid] = row.adset_name || aid;
      if (!bucket.conj[aid]) bucket.conj[aid] = {};
      add(bucket.conj[aid], horaBR);
    }

    // Conjuntos ordenados por investimento (hoje+ontem) desc
    const conjInvest = {};
    for (const dia of [dataHoje, dataOntem]) {
      for (const [aid, byHora] of Object.entries(dias[dia].conj)) {
        conjInvest[aid] = (conjInvest[aid] || 0) + Object.values(byHora).reduce((s, m) => s + m.investimento, 0);
      }
    }
    const conjuntos = Object.keys(conjNomes)
      .map(aid => ({ adset_id: aid, adset_name: conjNomes[aid], investimento: +(conjInvest[aid] || 0).toFixed(2) }))
      .sort((a, b) => b.investimento - a.investimento);

    // Séries por conjunto: { adset_id → { hoje:[...], ontem:[...] } }
    const porConjunto = {};
    for (const c of conjuntos) {
      porConjunto[c.adset_id] = {
        hoje:  finalizeRows(dias[dataHoje].conj[c.adset_id]  || {}, horaAtual),
        ontem: finalizeRows(dias[dataOntem].conj[c.adset_id] || {}, null),
      };
    }

    const payload = {
      campaign_id: campaignId,
      hora_atual: horaAtual,
      data_hoje: dataHoje,
      data_ontem: dataOntem,
      hoje:  finalizeRows(dias[dataHoje].total, horaAtual),
      ontem: finalizeRows(dias[dataOntem].total, null),
      conjuntos,
      por_conjunto: porConjunto,
      sem_dados: rows.length === 0,
    };
    setCache(cacheKey, payload);
    res.json(payload);
  } catch (err) {
    console.error('[campanha-intraday]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
