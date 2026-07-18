'use strict';
const supabase = require('../../../lib/supabase');

// Relatório customizável sobre ads_consolidados: o usuário escolhe dimensões
// (agrupamento), métricas e filtros; agregação feita aqui em JS porque o
// PostgREST não expõe GROUP BY dinâmico.

const DIMENSOES = {
  data:     { col: 'data',          label: 'Data' },
  pais:     { col: 'pais_sigla',    label: 'País' },
  utm:      { col: 'ad_utm',        label: 'UTM' },
  campanha: { col: 'campanha_meta', label: 'Campanha' },
  dominio:  { col: 'dominio_id',    label: 'Domínio' },
  conta:    { col: 'account_id',    label: 'Conta Meta' },
  tipo:     { col: 'tipo',          label: 'Tipo' },
  nicho:    { col: 'nicho',         label: 'Nicho' },
};

// Métricas somáveis (colunas da tabela)
const SOMAS = {
  valor_gasto:       { label: 'Gasto (R$)',        fmt: 'moeda' },
  faturamento_real:  { label: 'Faturamento (R$)',  fmt: 'moeda' },
  faturamento_bruto: { label: 'Fat. Bruto (R$)',   fmt: 'moeda' },
  lucro:             { label: 'Lucro (R$)',        fmt: 'moeda' },
  cliques:           { label: 'Cliques',           fmt: 'int' },
  impressoes_gam:    { label: 'Impressões GAM',    fmt: 'int' },
  resultado:         { label: 'Resultados',        fmt: 'int' },
  sessoes_meta:      { label: 'Sessões (Meta)',    fmt: 'int' },
  conversas_meta:    { label: 'Conversas (Meta)',  fmt: 'int' },
  orcamento_total:   { label: 'Orçamento (R$)',    fmt: 'moeda' },
};

// Métricas derivadas das somas — mesmas fórmulas do sync.js
const DERIVADAS = {
  roi:             { label: 'ROI (%)',         fmt: 'pct',   calc: a => a.valor_gasto > 0 ? ((a.faturamento_real - a.valor_gasto) / a.valor_gasto) * 100 : null, dep: ['valor_gasto', 'faturamento_real'] },
  roas:            { label: 'ROAS',            fmt: 'num',   calc: a => a.valor_gasto > 0 ? a.faturamento_real / a.valor_gasto : null,                            dep: ['valor_gasto', 'faturamento_real'] },
  cpc:             { label: 'CPC (R$)',        fmt: 'moeda', calc: a => a.cliques > 0 ? a.valor_gasto / a.cliques : null,                                         dep: ['valor_gasto', 'cliques'] },
  ecpm:            { label: 'eCPM (R$)',       fmt: 'moeda', calc: a => a.impressoes_gam > 0 ? (a.faturamento_bruto / a.impressoes_gam) * 1000 : null,            dep: ['faturamento_bruto', 'impressoes_gam'] },
  rps:             { label: 'RPS (R$)',        fmt: 'moeda', calc: a => a.sessoes_meta > 0 ? a.faturamento_real / a.sessoes_meta : null,                          dep: ['faturamento_real', 'sessoes_meta'] },
  breakeven:       { label: 'Breakeven',       fmt: 'num',   calc: a => a.faturamento_real > 0 && a.valor_gasto > 0 ? a.valor_gasto / a.faturamento_real : null,  dep: ['valor_gasto', 'faturamento_real'] },
  custo_resultado: { label: 'Custo/Result.',   fmt: 'moeda', calc: a => a.resultado > 0 ? a.valor_gasto / a.resultado : null,                                     dep: ['valor_gasto', 'resultado'] },
  dias_ativos:     { label: 'Dias Ativos',     fmt: 'int',   calc: a => a._dias.size,                                                                             dep: [] },
};

async function fetchAllPaginated(buildQuery) {
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data || []);
    if (!data || data.length < PAGE) break;
  }
  return all;
}

const isoShift = (iso, dias) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

async function customHandler(req, res) {
  try {
    const { since, until, dimensoes, metricas, filtros = {}, ordenarPor, ordem, comparar } = req.body || {};

    if (!since || !until) return res.status(400).json({ error: 'Período (since/until) é obrigatório' });
    const dims = (Array.isArray(dimensoes) ? dimensoes : []).filter(d => DIMENSOES[d]);
    const mets = (Array.isArray(metricas) ? metricas : []).filter(m => SOMAS[m] || DERIVADAS[m]);
    if (!dims.length) return res.status(400).json({ error: 'Selecione pelo menos uma dimensão' });
    if (!mets.length) return res.status(400).json({ error: 'Selecione pelo menos uma métrica' });

    // Colunas necessárias: dimensões + somas pedidas + dependências das derivadas
    const somasNecessarias = new Set();
    for (const m of mets) {
      if (SOMAS[m]) somasNecessarias.add(m);
      else DERIVADAS[m].dep.forEach(d => somasNecessarias.add(d));
    }
    somasNecessarias.add('valor_gasto'); // sempre — usado em dias_ativos e na ordenação default
    const selectCols = [...new Set([...dims.map(d => DIMENSOES[d].col), 'data', ...somasNecessarias])].join(',');

    const buildQuery = (df, dt) => () => {
      let q = supabase.from('ads_consolidados').select(selectCols).gte('data', df).lte('data', dt);
      if (filtros.pais?.length)  q = q.in('pais_sigla', filtros.pais);
      if (filtros.utm)           q = q.ilike('ad_utm', `%${filtros.utm}%`);
      if (filtros.dominio_id)    q = q.eq('dominio_id', filtros.dominio_id);
      if (filtros.account_id)    q = q.eq('account_id', filtros.account_id);
      if (filtros.tipo)          q = q.eq('tipo', filtros.tipo);
      return q;
    };

    const rows = await fetchAllPaginated(buildQuery(since, until));

    // Mapas de nomes para dimensões com id
    const nomes = { dominio: {}, conta: {} };
    if (dims.includes('dominio')) {
      const { data } = await supabase.from('dominios').select('id,nome');
      (data || []).forEach(d => { nomes.dominio[d.id] = d.nome; });
    }
    if (dims.includes('conta')) {
      const { data } = await supabase.from('meta_accounts').select('ad_account_id,nome');
      (data || []).forEach(c => {
        const k = String(c.ad_account_id).startsWith('act_') ? String(c.ad_account_id) : `act_${c.ad_account_id}`;
        nomes.conta[k] = c.nome;
      });
    }

    // Agrupa; shiftDias desloca a dimensão "data" do período anterior para
    // alinhar dia N com dia N do período atual (comparação posicional)
    const agrupar = (lista, shiftDias = 0) => {
      const gs = {};
      for (const r of lista) {
        const dimVals = dims.map(d => {
          let v = r[DIMENSOES[d].col];
          if (d === 'data' && shiftDias) v = isoShift(v, shiftDias);
          if (d === 'dominio') return nomes.dominio[v] || String(v ?? '—');
          if (d === 'conta')   return nomes.conta[v] || String(v ?? '—');
          return String(v ?? '—');
        });
        const k = dimVals.join('\u0000');
        let g = gs[k];
        if (!g) {
          g = gs[k] = { _dims: dimVals, _dias: new Set() };
          for (const s of somasNecessarias) g[s] = 0;
        }
        for (const s of somasNecessarias) g[s] += Number(r[s] || 0);
        if (Number(r.valor_gasto || 0) > 0) g._dias.add(r.data);
      }
      return gs;
    };

    const grupos = agrupar(rows);

    // Período anterior: mesma duração, terminando no dia anterior ao since
    let gruposAnt = null, periodoAnterior = null;
    if (comparar) {
      const dias = Math.round((new Date(until) - new Date(since)) / 86400000) + 1;
      periodoAnterior = { since: isoShift(since, -dias), until: isoShift(since, -1) };
      const prevRows = await fetchAllPaginated(buildQuery(periodoAnterior.since, periodoAnterior.until));
      gruposAnt = agrupar(prevRows, dias);
    }

    const colunas = [
      ...dims.map(d => ({ key: d, label: DIMENSOES[d].label, tipo: 'dim' })),
      ...mets.flatMap(m => {
        const def = SOMAS[m] || DERIVADAS[m];
        const base = { key: m, label: def.label, tipo: 'met', fmt: def.fmt };
        if (!comparar) return [base];
        return [
          base,
          { key: `${m}_ant`, label: `${def.label} (ant.)`, tipo: 'met', fmt: def.fmt },
          // ROI já é %: variação em pontos percentuais; demais em % relativo
          { key: `${m}_var`, label: `Δ ${def.label}`, tipo: 'met', fmt: def.fmt === 'pct' ? 'pp' : 'pct' },
        ];
      }),
    ];

    const round = v => v === null ? null : +v.toFixed(4);
    const calcMet = (g, m) => !g ? null : SOMAS[m] ? +g[m].toFixed(2) : round(DERIVADAS[m].calc(g));
    const variacao = (cur, ant, fmt) => {
      if (cur === null || ant === null) return null;
      if (fmt === 'pct') return +(cur - ant).toFixed(2);
      if (!ant) return null;
      return +(((cur - ant) / Math.abs(ant)) * 100).toFixed(2);
    };

    const montarLinha = (g, gAnt) => {
      const linha = {};
      dims.forEach((d, i) => { linha[d] = g._dims[i]; });
      for (const m of mets) {
        linha[m] = calcMet(g, m);
        if (comparar) {
          const ant = calcMet(gAnt, m);
          linha[`${m}_ant`] = ant;
          linha[`${m}_var`] = variacao(linha[m], ant, (SOMAS[m] || DERIVADAS[m]).fmt);
        }
      }
      return linha;
    };

    const out = Object.entries(grupos).map(([k, g]) => montarLinha(g, gruposAnt ? gruposAnt[k] : null));

    // Totais (derivadas recalculadas sobre as somas globais)
    const somaTotal = gs => {
      const t = { _dims: [], _dias: new Set() };
      for (const s of somasNecessarias) t[s] = 0;
      Object.values(gs || {}).forEach(g => {
        for (const s of somasNecessarias) t[s] += g[s];
        g._dias.forEach(d => t._dias.add(d));
      });
      return t;
    };
    const totais = montarLinha(somaTotal(grupos), comparar ? somaTotal(gruposAnt) : null);
    dims.forEach(d => delete totais[d]);

    const sortKey = colunas.some(c => c.key === ordenarPor) ? ordenarPor : mets[0];
    const dir = ordem === 'asc' ? 1 : -1;
    out.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });

    res.json({ periodo: { since, until }, periodo_anterior: periodoAnterior, colunas, rows: out, totais, total_linhas: out.length });
  } catch (e) {
    console.error('[relatorios]', e.message);
    res.status(500).json({ error: e.message });
  }
}

module.exports = { customHandler };
