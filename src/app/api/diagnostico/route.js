'use strict';
/*
 * /api/diagnostico — motor de diagnóstico de funil nos 3 níveis (geral | campanha | conjunto).
 * Junta meta_conjunto + funil_conjunto + receita_ads na janela e roda src/lib/diagnostico.js.
 * Ver [[project_repaginacao_dash]]. Grão base = conjunto(adset); campanha e geral agregam
 * somando-antes-de-dividir (reusa diagnosticarConjunto sobre a união das linhas).
 *
 * Query: ?nivel=geral|campanha|conjunto & since & until & domain & adset_id & campaign_id
 *  - geral:    janela default = 1 dia (until). Banda "Diagnóstico do dia".
 *  - campanha: janela default = 7 dias. Uma linha por campaign_id.
 *  - conjunto: janela default = 14 dias (acumulado p/ veredito). ?adset_id filtra 1 conjunto.
 * Mediana de referência = SEMPRE os 7 dias fechados terminando em `until`.
 */
const supabase = require('../../../lib/supabase');
const { fetchAll } = require('../../../lib/fetchAll');
const { hojeBR, addDiasISO } = require('../../../lib/datas');
const D = require('../../../lib/diagnostico');

// carrega config (global + override por domínio) → { chave: valor }
async function carregarConfig(dominioId) {
  const cfg = { ...D.CFG_PADRAO };
  try {
    const { data } = await supabase.from('diagnostico_config').select('chave,valor,dominio_id');
    for (const r of data || []) if (r.dominio_id == null) cfg[r.chave] = Number(r.valor);
    if (dominioId != null) for (const r of data || []) if (r.dominio_id === dominioId) cfg[r.chave] = Number(r.valor);
  } catch { /* usa padrão */ }
  return cfg;
}

// junta as 3 tabelas por (data, adset_id) na janela [ini, fim], filtrando por domínio/RBAC
async function buscarLinhas(ini, fim, dominioId, restrito) {
  const metaQ = () => {
    let q = supabase.from('meta_conjunto')
      .select('data,adset_id,campaign_id,campaign_name,adset_name,account_id,dominio_id,gasto_brl,impressoes,cliques_link,conversas_meta,sessoes_meta,results,orcamento_brl')
      .gte('data', ini).lte('data', fim);
    if (dominioId != null) q = q.eq('dominio_id', dominioId);
    if (restrito) q = q.in('dominio_id', restrito);
    return q;
  };
  const funilQ = () => supabase.from('funil_conjunto')
    .select('data,adset_id,leads_entrada,cliques_ad,threads,leads_qualificados,sessoes,leads_com_sessao')
    .gte('data', ini).lte('data', fim);
  const recQ = () => supabase.from('receita_ads')
    .select('data,adset_id,impressoes,receita_bruta')
    .gte('data', ini).lte('data', fim);

  const [meta, funil, rec] = await Promise.all([fetchAll(metaQ), fetchAll(funilQ), fetchAll(recQ)]);
  if (meta.error) throw new Error('meta_conjunto: ' + meta.error.message);

  const iso = (d) => String(d).slice(0, 10);
  const alvo = new Set();                       // adset_ids que interessam (do meta, já filtrado por domínio)
  for (const m of meta.data) alvo.add(m.adset_id);

  const funilMap = new Map();
  for (const f of funil.data || []) if (alvo.has(f.adset_id)) funilMap.set(iso(f.data) + '|' + f.adset_id, f);
  const recMap = new Map();                      // receita_ads é por ad_id → agrega p/ (data, adset)
  for (const r of rec.data || []) {
    if (!r.adset_id || !alvo.has(r.adset_id)) continue;
    const k = iso(r.data) + '|' + r.adset_id;
    let o = recMap.get(k); if (!o) { o = { imp: 0, rev: 0 }; recMap.set(k, o); }
    o.imp += Number(r.impressoes || 0); o.rev += Number(r.receita_bruta || 0);
  }

  const linhas = [];
  for (const m of meta.data) {
    const data = iso(m.data), k = data + '|' + m.adset_id;
    const f = funilMap.get(k) || {}; const rr = recMap.get(k) || { imp: 0, rev: 0 };
    linhas.push({
      data, adset_id: m.adset_id, campaign_id: m.campaign_id, campaign_name: m.campaign_name,
      adset_name: m.adset_name, account_id: m.account_id, dominio_id: m.dominio_id,
      gasto_brl: m.gasto_brl, impressoes_meta: m.impressoes, cliques_link: m.cliques_link,
      conversas_meta: m.conversas_meta, sessoes_meta: m.sessoes_meta, results: m.results,
      orcamento_brl: m.orcamento_brl,
      leads_entrada: f.leads_entrada || 0, cliques_ad: f.cliques_ad || 0, threads: f.threads || 0,
      leads_qualificados: f.leads_qualificados || 0, sessoes: f.sessoes || 0, leads_com_sessao: f.leads_com_sessao || 0,
      impressoes_gam: rr.imp, receita_bruta: rr.rev,
    });
  }
  return linhas;
}

// gargalos ordenados por impacto (fator crescente), com potencial de correção de cada um
function gargalosRankeados(conj, cfg) {
  return (conj.fatores || [])
    .filter(n => n.fator != null && n.fator < 1)
    .sort((a, b) => a.fator - b.fator)
    .map(n => ({
      chave: n.chave, label: n.label, fator: n.fator, delta: n.delta, classe: n.classe,
      piso_falha: n.piso_falha, piso: n.piso, valor: n.valor, mediana: n.mediana,
      // potencial: ROAS se este fator voltar à mediana (fator→1)
      potencial: conj.roas != null && n.fator > 0 ? Math.round((conj.roas / n.fator) * 1000) / 1000 : null,
      // se fura piso: ROAS ao atingir o piso absoluto
      potencial_piso: (n.piso != null && n.valor != null && n.valor < n.piso && n.valor > 0 && conj.roas != null)
        ? Math.round((conj.roas * (n.piso / n.valor)) * 1000) / 1000 : null,
    }));
}

async function handler(req, res) {
  try {
    const nivel = (req.query.nivel || 'geral').toLowerCase();
    const until = req.query.until || hojeBR();
    const janelaPadrao = nivel === 'geral' ? 0 : (nivel === 'campanha' ? 6 : 13);
    const since = req.query.since || addDiasISO(until, -janelaPadrao);
    const medIni = addDiasISO(until, -6);                    // referência 7d fechados
    const ini = since < medIni ? since : medIni;             // busca cobre janela + mediana

    // domínio + RBAC
    let dominioId = null;
    if (req.query.domain && req.query.domain !== 'all') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', req.query.domain).maybeSingle();
      dominioId = d?.id ?? null;
    }
    const restrito = Array.isArray(req.allowedDominios)
      ? (req.allowedDominios.length ? req.allowedDominios : [-1]) : null;

    const cfg = await carregarConfig(dominioId);
    const linhas = await buscarLinhas(ini, until, dominioId, restrito);

    const dentro = (d) => d >= medIni && d <= until;
    const medianRows = linhas.filter(l => dentro(l.data));
    const metricRows = linhas.filter(l => l.data >= since && l.data <= until);
    const medianas = D.medianas7d(medianRows, cfg.taxa_gam);

    // atalho: conjuntos (átomos) da janela de métrica
    const porAdset = new Map();
    for (const l of metricRows) { if (!porAdset.has(l.adset_id)) porAdset.set(l.adset_id, []); porAdset.get(l.adset_id).push(l); }
    const conjuntos = [...porAdset.values()].map(ls => D.diagnosticarConjunto(ls, medianas, cfg, {}));

    const base = { nivel, since, until, mediana_janela: { de: medIni, ate: until, dias: medianas._amostraDias }, medianas, cfg };

    if (nivel === 'conjunto') {
      if (req.query.adset_id) {
        const ls = porAdset.get(req.query.adset_id) || [];
        if (!ls.length) return res.json({ ...base, conjunto: null });
        const conj = D.diagnosticarConjunto(ls, medianas, cfg, {});
        return res.json({ ...base, conjunto: conj, gargalos: gargalosRankeados(conj, cfg) });
      }
      // sem adset_id → lista todos os conjuntos da janela
      return res.json({ ...base, conjuntos: conjuntos.sort((a, b) => (a.roas ?? 9) - (b.roas ?? 9)) });
    }

    if (nivel === 'campanha') {
      // Ficha de UMA campanha (clicou no nome na tabela) → diag + gargalos + conjuntos filhos.
      if (req.query.campaign_id) {
        const ls = metricRows.filter(l => l.campaign_id === req.query.campaign_id);
        if (!ls.length) return res.json({ ...base, campanha: null });
        const c = D.diagnosticarConjunto(ls, medianas, cfg, { campaign_id: ls[0].campaign_id, campaign_name: ls[0].campaign_name });
        const filhos = [...new Set(ls.map(x => x.adset_id))]
          .map(ad => D.diagnosticarConjunto(ls.filter(x => x.adset_id === ad), medianas, cfg, { adset_id: ad }))
          .sort((a, b) => (a.roas ?? 9) - (b.roas ?? 9));
        return res.json({ ...base, campanha: c, gargalos: gargalosRankeados(c, cfg), conjuntos: filhos });
      }
      const porCamp = new Map();
      for (const l of metricRows) {
        const k = l.campaign_id || ('·legado·' + (l.campaign_name || '?'));
        if (!porCamp.has(k)) porCamp.set(k, []); porCamp.get(k).push(l);
      }
      const campanhas = [...porCamp.entries()].map(([k, ls]) => {
        const c = D.diagnosticarConjunto(ls, medianas, cfg, {
          campaign_id: ls[0].campaign_id, campaign_name: ls[0].campaign_name,
        });
        const filhos = [...new Set(ls.map(x => x.adset_id))]
          .map(ad => D.diagnosticarConjunto(ls.filter(x => x.adset_id === ad), medianas, cfg, { adset_id: ad }));
        return { ...c, campaign_key: k, conjuntos: filhos.sort((a, b) => (a.roas ?? 9) - (b.roas ?? 9)) };
      }).sort((a, b) => (a.roas ?? 9) - (b.roas ?? 9));
      return res.json({ ...base, campanhas });
    }

    // ── nivel geral ──
    // Banda de 4 fatores = a janela pedida (default 1 dia fechado).
    const geral = D.diagnosticarConjunto(metricRows, medianas, cfg, {});
    // População de conjuntos p/ distribuição e classificação sistêmico/local = ACUMULADO 7d
    // (no dia isolado o gasto por conjunto fica < piso de volume e os fatores viram ruído).
    const acumAdset = new Map();
    for (const l of medianRows) { if (!acumAdset.has(l.adset_id)) acumAdset.set(l.adset_id, []); acumAdset.get(l.adset_id).push(l); }
    const conjuntosAcum = [...acumAdset.values()].map(ls => D.diagnosticarConjunto(ls, medianas, cfg, {}));
    // classificação sistêmico/local de cada gargalo presente
    const chavesGargalo = [...new Set(conjuntosAcum.filter(c => c.gargalo).map(c => c.gargalo.chave))];
    const classificacoes = {};
    for (const ch of chavesGargalo) classificacoes[ch] = D.classificarGargalo(ch, conjuntosAcum, cfg);
    // alertas de piso (fatores do agregado que furam o piso absoluto)
    const alertas_piso = (geral.fatores || []).filter(n => n.piso_falha)
      .map(n => ({ chave: n.chave, label: n.label, valor: n.valor, piso: n.piso,
        classificacao: classificacoes[n.chave] || D.classificarGargalo(n.chave, conjuntosAcum, cfg) }));
    // distribuição de veredito por rótulo (só conjuntos acumulados com volume)
    const distribuicao = {};
    for (const c of conjuntosAcum) {
      const r = c.veredito.rotulo.split(' · ')[0];
      distribuicao[r] = (distribuicao[r] || 0) + 1;
    }
    return res.json({
      ...base, geral,
      gargalos: gargalosRankeados(geral, cfg),               // p/ a ficha global (Ver detalhado)
      classificacao_gargalo: geral.gargalo ? classificacoes[geral.gargalo.chave] : null,
      alertas_piso, distribuicao_veredito: distribuicao,
      conjuntos_total: conjuntosAcum.length,
      conjuntos_com_veredito: conjuntosAcum.filter(c => c.veredito.classe !== 'mute').length,
      // histograma de ROI (bandas) + conjuntos p/ tabela da ficha global
      conjuntos: conjuntosAcum.map(c => ({ adset_id: c.adset_id, adset_name: c.adset_name,
        campaign_name: c.campaign_name, dias: c.dias, gasto: c.gasto, roas: c.roas,
        gargalo: c.gargalo, veredito: c.veredito })).sort((a, b) => (a.roas ?? 9) - (b.roas ?? 9)),
    });
  } catch (err) {
    console.error('[/api/diagnostico]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

module.exports = handler;
