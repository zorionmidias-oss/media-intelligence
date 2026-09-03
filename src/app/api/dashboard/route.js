'use strict';
const supabase = require('../../../lib/supabase');
const PERMS = require('../../../lib/permissions');
const METRICAS = require('../../../lib/metricas');
const { fetchAll } = require('../../../lib/fetchAll');
const { hojeBR, diasAtrasBR } = require('../../../lib/datas');
const { extractEstrutura } = require('../../../lib/parser');

async function handler(req, res) {
  try {
    const { since, until, domain, tipo } = req.query;
    // Datas do negócio no fuso BR — "hoje" UTC vira amanhã a partir das 21h BRT
    const dateFrom = since || diasAtrasBR(30);
    const dateTo = until || hojeBR();

    // Filter by domain (join dominios)
    let domainId = null;
    if (domain && domain !== 'all') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', domain).maybeSingle();
      domainId = d?.id || null;
    }

    // Main query (fábrica p/ fetchAll — período longo passa de 1000 linhas e o
    // PostgREST cortava, subcontando investimento nos acumulados de mês)
    const query = () => {
      let q = supabase
        .from('ads_consolidados')
        .select('*,dominios(nome,prefixo_campanha)')
        .gte('data', dateFrom)
        .lte('data', dateTo)
        .order('data', { ascending: true })
        .order('id', { ascending: true });
      if (tipo && tipo !== 'all') q = q.eq('tipo', tipo);
      if (domainId) q = q.eq('dominio_id', domainId);
      if (Array.isArray(req.allowedDominios)) {
        q = q.in('dominio_id', req.allowedDominios.length ? req.allowedDominios : [-1]);
      }
      return q;
    };

    // data_inicio = primeiro dia com GASTO real (dia que começou a rodar), via
    // views agregadas no banco (v_inicio_*). A query antiga puxava todas as
    // linhas com atividade e o PostgREST cortava em 1000 — campanha nova nunca
    // aparecia no mapa.
    let inicioCampQ = supabase.from('v_inicio_por_campanha').select('campaign_id,data_inicio');
    let inicioUtmQ = supabase.from('v_inicio_por_utm').select('dominio_id,ad_utm,pais_sigla,data_inicio');
    if (domainId) inicioUtmQ = inicioUtmQ.eq('dominio_id', domainId);

    // Colaborador restrito a domínios: limita aos IDs permitidos (vazio => nenhum dado).
    if (Array.isArray(req.allowedDominios)) {
      const ids = req.allowedDominios.length ? req.allowedDominios : [-1];
      inicioUtmQ = inicioUtmQ.in('dominio_id', ids);
    }

    // Última otimização por campanha (tabela dedicada `campanha_otimizacao`, 1 linha/campaign_id).
    // fetchAll p/ não cortar em 1000. Alimentada pelo botão ✓ (POST /api/campanha/:id/otimizada).
    const otimQ = () => supabase.from('campanha_otimizacao').select('campaign_id,ultima_otimizacao');

    const [{ data: rows, error }, { data: inicioCampRows }, { data: inicioUtmRows }, { data: otimRows }] =
      await Promise.all([fetchAll(query), inicioCampQ, inicioUtmQ, fetchAll(otimQ)]);
    if (error) return res.status(500).json({ error: error.message });

    // Mapa campaign_id -> ultima_otimizacao (timestamp ISO; BR-bucket fica pro frontend/datas.js)
    const ultimaOtimMap = {};
    for (const r of otimRows || []) {
      if (r.campaign_id && r.ultima_otimizacao) ultimaOtimMap[r.campaign_id] = r.ultima_otimizacao;
    }

    // Chave de agrupamento anti-erro: campaign_id quando a linha tem (id nunca é
    // ambíguo — duas páginas homônimas ficam separadas); fallback legado por nome
    // para histórico sem carimbo.
    const rowKey = r => r.campaign_id ? `c:${r.campaign_id}` : `${r.dominio_id}|${r.ad_utm}|${r.pais_sigla || ''}`;

    // data_inicio map: chave de campanha e chave legada
    const inicioMap = {};
    for (const r of inicioCampRows || []) {
      if (r.data_inicio) inicioMap[`c:${r.campaign_id}`] = r.data_inicio;
    }
    for (const r of inicioUtmRows || []) {
      if (r.data_inicio) inicioMap[`${r.dominio_id}|${r.ad_utm}|${r.pais_sigla || ''}`] = r.data_inicio;
    }

    // Aggregate by campaign_id (novo) ou (dominio_id, ad_utm, pais_sigla) (legado)
    const utmMap = {};
    for (const r of rows || []) {
      const key = rowKey(r);
      if (!utmMap[key]) {
        utmMap[key] = {
          _key: key,
          campaign_id: r.campaign_id || null,
          ad_utm: r.ad_utm,
          tipo: r.tipo,
          dominio: r.dominios?.nome || null,
          campanha_meta: r.campanha_meta,
          pais_sigla: r.pais_sigla || '',
          pais_nome: r.pais_nome || '',
          valor_gasto: 0,
          faturamento_real: 0,
          faturamento_bruto: 0,
          lucro: 0,
          cliques: 0,
          impressoes_gam: 0,
          resultado: 0,
          sessoes_meta: 0,
          conversas_meta: 0,
          orcamento_total: 0,
          // Weighted accumulation
          _cpcSum: 0, _cpcW: 0,
          _ctrSum: 0, _ctrW: 0,
          _ecpmSum: 0, _ecpmW: 0,
          _rpsSum: 0, _rpsW: 0,
          // Previsão (today's row only)
          previsao_impressoes: 0,
          previsao_faturamento_real: 0,
          previsao_lucro: 0,
          previsao_roas: 0,
          // Série diária p/ sparkline de tendência (ROI por dia). data -> {gasto,fat}
          _serie: {},
        };
      }
      const g = utmMap[key];
      // Acumula por dia (mantém granularidade p/ a série de ROI da tendência)
      if (r.data) {
        const s = g._serie[r.data] || (g._serie[r.data] = { gasto: 0, fat: 0 });
        s.gasto += Number(r.valor_gasto || 0);
        s.fat += Number(r.faturamento_real || 0);
      }
      g.valor_gasto += Number(r.valor_gasto || 0);
      g.faturamento_real += Number(r.faturamento_real || 0);
      g.faturamento_bruto += Number(r.faturamento_bruto || 0);
      g.lucro += Number(r.lucro || 0);
      g.cliques += Number(r.cliques || 0);
      g.impressoes_gam += Number(r.impressoes_gam || 0);
      g.resultado += Number(r.resultado || 0);
      g.sessoes_meta += Number(r.sessoes_meta || 0);
      g.conversas_meta += Number(r.conversas_meta || 0);
      g.orcamento_total = Math.max(g.orcamento_total, Number(r.orcamento_total || 0));

      const cliques = Number(r.cliques || 0);
      const imps = Number(r.impressoes_gam || 0);
      if ((r.cpc || 0) > 0 && cliques > 0) { g._cpcSum += r.cpc * cliques; g._cpcW += cliques; }
      if ((r.ctr || 0) > 0 && cliques > 0) { g._ctrSum += r.ctr * cliques; g._ctrW += cliques; }
      if ((r.ecpm || 0) > 0 && imps > 0) { g._ecpmSum += r.ecpm * imps; g._ecpmW += imps; }
      if ((r.rps || 0) > 0 && imps > 0) { g._rpsSum += r.rps * imps; g._rpsW += imps; }

      // Override previsão from most recent row
      if (Number(r.previsao_impressoes || 0) > 0) {
        g.previsao_impressoes = Number(r.previsao_impressoes);
        g.previsao_faturamento_real = Number(r.previsao_faturamento_real || 0);
        g.previsao_lucro = Number(r.previsao_lucro || 0);
        g.previsao_roas = Number(r.previsao_roas || 0);
      }
    }

    const aggregated = Object.values(utmMap)
      // Filter: only UTMs with investimento > 0 OR faturamento > 0
      .filter(g => g.valor_gasto > 0 || g.faturamento_real > 0)
      .map(g => {
        const sessoes   = g.sessoes_meta;
        const conversas = g.conversas_meta;

        // Métricas derivadas: SEMPRE via módulo canônico, a partir das somas brutas
        const m = METRICAS.derivar({
          investimento: g.valor_gasto,
          faturamento: g.faturamento_real,
          sessoes,
          conversas,
          impressoes: g.impressoes_gam,
        });

        // Rótulo da página = último colchete do nome da campanha ("[X] [Y] [ELIANA MARTINS]")
        const brackets = [...String(g.campanha_meta || '').matchAll(/\[([^\]]+)\]/g)];
        const pagina = brackets.length >= 2 ? brackets[brackets.length - 1][1].trim() : null;

        // Série diária de ROI (%) p/ sparkline de tendência — ordenada por data.
        // ROI = (fat − gasto)/gasto × 100 (faturamento_real já é líquido; NÃO reaplicar ×0.9).
        const roi_serie = Object.keys(g._serie).sort().map(data => {
          const s = g._serie[data];
          return { data, roi: s.gasto > 0 ? +(((s.fat - s.gasto) / s.gasto) * 100).toFixed(2) : 0 };
        });

        return {
          ad_utm: g.ad_utm,
          campaign_id: g.campaign_id,
          pagina,
          // "E1"/"E2"… do início do nome da campanha (convenção de estrutura)
          estrutura: extractEstrutura(g.campanha_meta),
          tipo: g.tipo,
          dominio: g.dominio,
          campanha_meta: g.campanha_meta,
          pais_sigla: g.pais_sigla,
          pais_nome: g.pais_nome,
          valor_gasto: +g.valor_gasto.toFixed(2),
          faturamento_real: +g.faturamento_real.toFixed(2),
          lucro: m.lucro,
          roas: m.roas || 0,
          cpc: g._cpcW > 0 ? +(g._cpcSum / g._cpcW).toFixed(4) : 0,
          ctr: g._ctrW > 0 ? +(g._ctrSum / g._ctrW).toFixed(2) : 0,
          custo_resultado: g.resultado > 0 ? +(g.valor_gasto / g.resultado).toFixed(2) : 0,
          resultado: g.resultado,
          impressoes_gam: g.impressoes_gam,
          // PAR = impressões GAM ÷ sessões (view_content) — anúncios por sessão
          par: m.par,
          ecpm: g._ecpmW > 0 ? +(g._ecpmSum / g._ecpmW).toFixed(2) : 0,
          // RPS canônico = faturamento ÷ sessões (retorno por sessão)
          rps: m.rps,
          custo_sessao: m.custo_sessao,
          orcamento_total: +g.orcamento_total.toFixed(2),
          previsao_impressoes: g.previsao_impressoes,
          previsao_faturamento_real: +g.previsao_faturamento_real.toFixed(2),
          previsao_lucro: +g.previsao_lucro.toFixed(2),
          previsao_roas: +g.previsao_roas.toFixed(4),
          // New fields
          sessoes: sessoes,
          conversas: conversas,
          sessao_por_conversa: m.sessao_por_lead,
          rps_sessao: m.rps,
          breakeven: m.breakeven,
          data_inicio: inicioMap[g._key] || null,
          // Última otimização (timestamp ISO) — só p/ linhas com campaign_id carimbado.
          ultima_otimizacao: g.campaign_id ? (ultimaOtimMap[g.campaign_id] || null) : null,
          // Série diária de ROI (%) do período — tendência (vermelha na baixa) no frontend.
          roi_serie,
        };
      })
      .sort((a, b) => b.valor_gasto - a.valor_gasto);

    // Summary KPIs
    const kpis = aggregated.reduce((acc, r) => {
      acc.faturamento  += r.faturamento_real;
      acc.investimento += r.valor_gasto;
      acc.lucro        += r.lucro;
      acc.impressoes   += r.impressoes_gam;
      acc.cliques      += r.resultado;
      acc.sessoes      += r.sessoes  || 0;
      acc.conversas    += r.conversas || 0;
      return acc;
    }, { faturamento: 0, investimento: 0, lucro: 0, impressoes: 0, cliques: 0, sessoes: 0, conversas: 0 });
    // Totais derivados: mesmas fórmulas canônicas, das SOMAS (nunca média de linhas)
    const mt = METRICAS.derivar({
      investimento: kpis.investimento,
      faturamento: kpis.faturamento,
      sessoes: kpis.sessoes,
      conversas: kpis.conversas,
      impressoes: kpis.impressoes,
    });
    kpis.roi  = kpis.investimento > 0 ? kpis.lucro / kpis.investimento * 100 : 0;
    kpis.roas = mt.roas || 0;
    kpis.sessao_por_conversa_total = mt.sessao_por_lead;
    kpis.rps_sessao_total          = mt.rps;
    kpis.breakeven_total           = mt.breakeven;
    kpis.par                       = mt.par;

    // Esconde país (sigla/nome) quando o elemento ver_pais está bloqueado p/ o usuário.
    const out = PERMS.elementBlocked(req.fullUser, 'ver_pais')
      ? aggregated.map(({ pais_sigla, pais_nome, ...rest }) => rest)
      : aggregated;

    res.json({ kpis, rows: out });
  } catch (err) {
    console.error('[dashboard]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
