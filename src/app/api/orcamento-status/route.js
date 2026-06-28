'use strict';
const supabase = require('../../../lib/supabase');
const { computeOrcamentoContas } = require('../../../lib/orcamento');

async function handler(req, res) {
  try {
    const now = new Date();
    const hoje = now.toISOString().slice(0, 10);
    const since = req.query.since || hoje;
    const until  = req.query.until  || hoje;
    const domain = req.query.domain;

    const dias = Math.round((new Date(until) - new Date(since)) / 86400000) + 1;

    // Filtro por domínio (nome) → resolve id (filtra usado) e prefixo (filtra orçamento Meta)
    let domainId = null;
    let prefixoFiltro = null;
    if (domain && domain !== 'all') {
      const { data: d } = await supabase
        .from('dominios')
        .select('id,prefixo_campanha')
        .eq('nome', domain)
        .maybeSingle();
      domainId = d?.id || null;
      prefixoFiltro = d?.prefixo_campanha || null;
    }

    // Orçamento de HOJE ao vivo (Meta) + conjuntos ativos sem gastar (travados)
    const { orcamentoHoje, porConta, stalled } = await computeOrcamentoContas({ prefixoFiltro });

    // USADO: soma de valor_gasto hoje e no período (já em BRL c/ imposto)
    let qHoje = supabase.from('ads_consolidados').select('valor_gasto').eq('data', hoje);
    let qPeriodo = supabase.from('ads_consolidados').select('valor_gasto').gte('data', since).lte('data', until);
    if (domainId) {
      qHoje = qHoje.eq('dominio_id', domainId);
      qPeriodo = qPeriodo.eq('dominio_id', domainId);
    }
    const { data: rowsHoje } = await qHoje;
    const { data: rowsPeriodo } = await qPeriodo;

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
