'use strict';
const supabase = require('../../../lib/supabase');
const { computeOrcamentoContas } = require('../../../lib/orcamento');

async function handler(req, res) {
  try {
    const now = new Date();
    const hoje = now.toISOString().slice(0, 10);
    const since = req.query.since || hoje;
    const until  = req.query.until  || hoje;

    const dias = Math.round((new Date(until) - new Date(since)) / 86400000) + 1;

    // Orçamento de HOJE ao vivo (Meta) + conjuntos ativos sem gastar (travados)
    const { orcamentoHoje, porConta, stalled } = await computeOrcamentoContas();

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
      conjuntos_sem_gasto: stalled,
    });
  } catch (err) {
    console.error('[orcamento-status]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
