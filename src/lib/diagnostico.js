'use strict';
/*
 * Motor de diagnóstico de funil (repaginação ago/2026, ver [[project_repaginacao_dash]]).
 *
 * ROAS = produto de 4 fatores, cada um relativo à mediana 7d da conta:
 *   ROAS = sessões/lead × PAR × eCPM_bruto × (1−taxa) / (1000 × custo/lead)
 * O produto dos 4 fatores RELATIVOS reconstrói ROAS/ROAS_ref (ROAS_ref = produto das medianas).
 * Validado em scripts/_valida-reconstrucao.js (100% dos conjuntos dentro de 2%).
 *
 * Dois testes por fator: (1) desvio relativo à mediana; (2) PISO absoluto — pega métrica
 * cronicamente ruim que a mediana não denuncia (ex.: PAR agregado ~1,04 vs piso 3,00).
 *
 * Grão base = conjunto (adset). Agrega para campanha e geral (conta/domínio) somando-antes-de-dividir.
 * Fonte dos números: meta_conjunto (gasto/impressões Meta) + funil_conjunto (leads/sessões do
 * trakeamento) + receita_ads (impressões/receita GAM). custo/lead e sessões/lead usam
 * leads_entrada (cid único do bot), NUNCA conversas da Meta (inflado ~2,32×).
 */

// ── Definição dos 4 fatores ────────────────────────────────────────────────
// inverso=true → menor é melhor (fator = mediana/valor). piso → chave de config (opcional).
const FATORES = [
  { chave: 'custo_lead', label: 'Custo por lead', unidade: 'brl',   inverso: true,  piso: null },
  { chave: 'spl',        label: 'Sessões por lead', unidade: 'num', inverso: false, piso: null },
  { chave: 'par',        label: 'PAR',            unidade: 'num',   inverso: false, piso: 'piso_par' },
  { chave: 'ecpm',       label: 'eCPM',           unidade: 'brl',   inverso: false, piso: null },
];

// ── Funil FINO (estilo mockup-painel_2): decomposição que telescopa e reconstrói o ROAS ──
// ROAS_liq = ctr × anuncio_lead × fluxo × clique_sessao × par × ecpm × (1−taxa) / cpm
// (as etapas telescopam: sessões = impMeta·ctr·anuncio_lead·fluxo·clique_sessao; impGam = sessões·par; receita = impGam·ecpm/1000)
const FUNIL_FINO = [
  { chave: 'cpm',          label: 'Leilão · CPM',      sub: 'gasto ÷ mil imp.',       unidade: 'brl', inverso: true,  piso: null },
  { chave: 'ctr',          label: 'Criativo · CTR',    sub: 'cliques ÷ impressões',   unidade: 'pct', inverso: false, piso: null },
  { chave: 'anuncio_lead', label: 'Anúncio → lead',    sub: 'leads ÷ cliques',        unidade: 'pct', inverso: false, piso: null },
  { chave: 'chegada',      label: 'Clique → sessão',   sub: 'chegaram ÷ leads',       unidade: 'pct', inverso: false, piso: null },
  { chave: 'engajamento',  label: 'Engajamento blog',  sub: 'sessões ÷ lead que chegou', unidade: 'num', inverso: false, piso: null },
  { chave: 'par',          label: 'Navegação · PAR',   sub: 'imp. GAM ÷ sessão',      unidade: 'num', inverso: false, piso: 'piso_par' },
  { chave: 'ecpm',         label: 'Página · eCPM',     sub: 'GAM bruto ÷ mil imp.',   unidade: 'brl', inverso: false, piso: null },
];

const CFG_PADRAO = {
  piso_par: 3.00, desvio_amber: 0.90, desvio_bad: 0.75,
  roi_matar: 0.20, roi_ultima_chance: 0.60, roi_maturacao: 0.90, roi_vivo: 1.40, roi_bom: 2.00,
  volume_min_brl: 60, sistemico_pct: 0.60, aproveitamento_min: 0.22, taxa_gam: 0.10,
};

// ── Somas: agrega um conjunto de linhas (conjunto×dia já unificadas) ────────
function somar(linhas) {
  const s = { gasto: 0, leads: 0, sess: 0, impGam: 0, impMeta: 0, cliquesLink: 0, cliquesAd: 0,
    leadsComSessao: 0, receitaBruta: 0, results: 0, conversasMeta: 0, sessoesMeta: 0,
    threads: 0, leadsQualificados: 0, orcamento: 0, dias: new Set() };
  for (const l of linhas) {
    s.gasto += num(l.gasto_brl);
    s.leads += num(l.leads_entrada);
    s.sess += num(l.sessoes);                 // sessões do blog (trakeamento)
    s.impGam += num(l.impressoes_gam);
    s.impMeta += num(l.impressoes_meta);
    s.cliquesLink += num(l.cliques_link);
    s.cliquesAd += num(l.cliques_ad);
    s.leadsComSessao += num(l.leads_com_sessao);
    s.threads += num(l.threads);
    s.leadsQualificados += num(l.leads_qualificados);
    s.receitaBruta += num(l.receita_bruta);
    s.results += num(l.results);
    s.conversasMeta += num(l.conversas_meta);
    s.sessoesMeta += num(l.sessoes_meta);
    s.orcamento = Math.max(s.orcamento, num(l.orcamento_brl)); // orçamento repete no dia; pega o maior
    if (l.data && (num(l.gasto_brl) > 0 || num(l.receita_bruta) > 0)) s.dias.add(l.data);
  }
  s.numDias = s.dias.size;
  return s;
}

// ── Fatores absolutos a partir das somas ───────────────────────────────────
function fatores(s, taxa) {
  const custo_lead = s.leads > 0 ? s.gasto / s.leads : null;
  const spl = s.leads > 0 ? s.sess / s.leads : null;
  const par = s.sess > 0 ? s.impGam / s.sess : null;
  const ecpm = s.impGam > 0 ? (s.receitaBruta / s.impGam) * 1000 : null; // BRUTO (×(1−taxa) entra na fórmula)
  const receitaLiq = s.receitaBruta * (1 - taxa);
  const roas = s.gasto > 0 ? receitaLiq / s.gasto : null;
  return { custo_lead, spl, par, ecpm, roas, receitaLiq };
}

// ── Métricas finas do funil (decomposição telescópica) ─────────────────────
function metricasFinas(s) {
  return {
    cpm: s.impMeta > 0 ? (s.gasto / s.impMeta) * 1000 : null,
    ctr: s.impMeta > 0 ? s.cliquesLink / s.impMeta : null,
    anuncio_lead: s.cliquesLink > 0 ? s.leads / s.cliquesLink : null,
    chegada: s.leads > 0 ? s.leadsComSessao / s.leads : null,       // clique→sessão (o vazamento)
    engajamento: s.leadsComSessao > 0 ? s.sess / s.leadsComSessao : null,
    par: s.sess > 0 ? s.impGam / s.sess : null,
    ecpm: s.impGam > 0 ? (s.receitaBruta / s.impGam) * 1000 : null,
  };
}

// ── Nós do funil fino (cada etapa vs mediana 7d + piso) ─────────────────────
function funilNos(mf, medianas, cfg) {
  return FUNIL_FINO.map(def => {
    const v = mf[def.chave], med = medianas[def.chave];
    let fator = null;
    if (v != null && med != null && v !== 0 && med !== 0) fator = def.inverso ? med / v : v / med;
    const pisoVal = def.piso ? Number(cfg[def.piso]) : null;
    const pisoFalha = (pisoVal != null && !def.inverso && v != null) ? v < pisoVal : false;
    return {
      chave: def.chave, label: def.label, sub: def.sub, unidade: def.unidade, inverso: def.inverso,
      valor: round(v, 4), mediana: round(med, 4), fator: round(fator, 3),
      delta: fator != null ? round(fator - 1, 3) : null,
      classe: pisoFalha ? 'bad' : classeFator(fator, cfg),
      piso: pisoVal, piso_falha: pisoFalha,
    };
  });
}

// ── ROAS reconstruído (validação) ──────────────────────────────────────────
function roasReconstruido(f, taxa) {
  if (f.custo_lead == null || !(f.custo_lead > 0)) return null;
  if (f.spl == null || f.par == null || f.ecpm == null) return null;
  return f.spl * f.par * f.ecpm * (1 - taxa) / (1000 * f.custo_lead);
}

// ── Nós: cada fator relativo à mediana + teste de piso ─────────────────────
// medianas = { custo_lead, spl, par, ecpm } (referência 7d da conta/domínio).
function nos(f, medianas, cfg) {
  const roasRef = roasReconstruido(medianas, cfg.taxa_gam); // produto das medianas
  const out = [];
  let produto = 1;
  for (const def of FATORES) {
    const v = f[def.chave], med = medianas[def.chave];
    let fator = null;
    if (v != null && med != null && v !== 0 && med !== 0) {
      fator = def.inverso ? med / v : v / med;   // <1 sempre = pior
    }
    if (fator != null) produto *= fator;
    const pisoVal = def.piso ? Number(cfg[def.piso]) : null;
    // piso: métrica cujo VALOR ABSOLUTO está abaixo do piso saudável (só faz sentido p/ "maior é melhor")
    const pisoFalha = (pisoVal != null && !def.inverso && v != null) ? v < pisoVal : false;
    out.push({
      chave: def.chave, label: def.label, unidade: def.unidade, inverso: def.inverso,
      valor: round(v, def.unidade === 'brl' ? 4 : 4),
      mediana: round(med, 4),
      fator: round(fator, 3),
      delta: fator != null ? round(fator - 1, 3) : null,   // fração; ex. -0.15 = −15%
      // Furar o piso absoluto vira vermelho SEMPRE — é o ponto do piso: pegar a métrica
      // cronicamente ruim que a mediana esconde (PAR ~1 fica "verde" vs sua própria mediana,
      // mas está muito abaixo do piso saudável 3,00). O piso vale mais que o desvio.
      classe: pisoFalha ? 'bad' : classeFator(fator, cfg),
      piso: pisoVal, piso_falha: pisoFalha,
    });
  }
  return { nos: out, produto: round(produto, 3), roasRef: round(roasRef, 3) };
}

function classeFator(fator, cfg) {
  if (fator == null) return 'neu';
  if (fator < Number(cfg.desvio_bad)) return 'bad';
  if (fator < Number(cfg.desvio_amber)) return 'amb';
  if (fator >= 1) return 'ok';
  return 'neu';
}

// ── Gargalo #1: fator com menor valor relativo (mais abaixo de 1) ──────────
function gargalo(nosArr) {
  let g = null;
  for (const n of nosArr) {
    if (n.fator == null) continue;
    if (g == null || n.fator < g.fator) g = n;
  }
  return g;
}

// ── Potencial: ROAS se o gargalo voltar à mediana (fator→1), e se atingir o piso ──
function potencial(roas, g, cfg) {
  if (roas == null || g == null || !(g.fator > 0)) return null;
  const corrigido = roas / g.fator; // levar o fator a 1,0 (mediana)
  const p = { corrigido: round(corrigido, 3) };
  // se o gargalo tem piso e está abaixo dele, mostra também o ganho de atingir o piso
  if (g.piso != null && g.valor != null && g.valor < g.piso && g.valor > 0) {
    p.ate_piso = round(roas * (g.piso / g.valor), 3);
  }
  return p;
}

// ── Veredito por banda de ROAS ─────────────────────────────────────────────
function veredito(roas, gastoAcum, numDias, cfg) {
  if (gastoAcum < Number(cfg.volume_min_brl)) {
    return { classe: 'mute', rotulo: 'aguardando volume',
      texto: `Gasto acumulado R$ ${fmtBRL(gastoAcum)} < piso de R$ ${fmtBRL(cfg.volume_min_brl)}. Sem veredito de ROAS — só gatilhos de topo.` };
  }
  if (roas == null) return { classe: 'mute', rotulo: 'sem dados', texto: 'Sem receita/leads suficientes para reconstruir o ROAS.' };
  const r = roas;
  if (r < Number(cfg.roi_matar))         return band('kill', 'matar', `ROAS ${f2(r)}x < ${f2(cfg.roi_matar)}. Corta.`);
  if (r < Number(cfg.roi_ultima_chance)) return band('kill', `última chance · D${numDias + 1}`, `ROAS ${f2(r)}x na faixa ${f2(cfg.roi_matar)}–${f2(cfg.roi_ultima_chance)}. Se não cruzar ${f2(cfg.roi_ultima_chance)} até D4, mata.`);
  if (r < Number(cfg.roi_maturacao))     return band('hold', 'maturação', `ROAS ${f2(r)}x na faixa ${f2(cfg.roi_ultima_chance)}–${f2(cfg.roi_maturacao)}. Ainda amadurecendo; segura.`);
  if (r < Number(cfg.roi_vivo))          return band('hold', 'vivo · não escala', `ROAS ${f2(r)}x na faixa ${f2(cfg.roi_maturacao)}–${f2(cfg.roi_vivo)}. Mantém rodando, mas não é candidato a orçamento.`);
  if (r < Number(cfg.roi_bom))           return band('ok', 'bom · escala leve', `ROAS ${f2(r)}x na faixa ${f2(cfg.roi_vivo)}–${f2(cfg.roi_bom)}. Escala leve (+20~30%).`);
  return band('ok', 'escalar', `ROAS ${f2(r)}x ≥ ${f2(cfg.roi_bom)}. Candidato a escala.`);
}
function band(classe, rotulo, texto) { return { classe, rotulo, texto }; }

// ── Diagnóstico de um conjunto ─────────────────────────────────────────────
// linhas = linhas (conjunto×dia) já unificadas de UM adset; medianas = referência 7d do domínio.
function diagnosticarConjunto(linhas, medianas, cfg, meta = {}) {
  const s = somar(linhas);
  const f = fatores(s, Number(cfg.taxa_gam));
  const mf = metricasFinas(s);
  const { nos: nosArr, produto, roasRef } = nos(f, medianas, cfg);
  const funil = funilNos(mf, medianas, cfg);   // funil completo (mockup-painel_2)
  const g = gargalo(nosArr);
  const roasFinal = f.roas;
  const vazamento = s.leads > 0 ? {
    clicou: s.leads, chegou: s.leadsComSessao, sessoes: s.sess,
    taxa_chegada: round(s.leads > 0 ? s.leadsComSessao / s.leads : null, 3),
    perdidos: Math.max(0, s.leads - s.leadsComSessao),
    sess_por_chegada: round(s.leadsComSessao > 0 ? s.sess / s.leadsComSessao : null, 2),
  } : null;
  return {
    adset_id: meta.adset_id ?? linhas[0]?.adset_id ?? null,
    adset_name: meta.adset_name ?? linhas[0]?.adset_name ?? null,
    campaign_id: meta.campaign_id ?? linhas[0]?.campaign_id ?? null,
    campaign_name: meta.campaign_name ?? linhas[0]?.campaign_name ?? null,
    dominio_id: meta.dominio_id ?? linhas[0]?.dominio_id ?? null,
    dias: s.numDias,
    gasto: round(s.gasto, 2), receita_liq: round(f.receitaLiq, 2),
    leads: s.leads, sessoes: s.sess, imp_gam: s.impGam, results: s.results,
    roas: round(roasFinal, 3), roas_ref: roasRef, produto,
    fatores: nosArr,
    funil,
    cliques_ad: s.cliquesAd, threads: s.threads, leads_qualificados: s.leadsQualificados,
    // números crus (p/ o desenho do funil e a seção "todas as métricas")
    brutos: {
      gasto: round(s.gasto, 2), imp_meta: s.impMeta, cliques_link: s.cliquesLink,
      conversas_meta: s.conversasMeta, sessoes_meta: s.sessoesMeta, results: s.results,
      leads: s.leads, cliques_ad: s.cliquesAd, threads: s.threads, leads_qualificados: s.leadsQualificados,
      leads_com_sessao: s.leadsComSessao, sessoes: s.sess,
      imp_gam: s.impGam, receita_bruta: round(s.receitaBruta, 2), receita_liq: round(f.receitaLiq, 2),
      orcamento: round(s.orcamento, 2),
      // derivadas cruas
      cpm: mf.cpm != null ? round(mf.cpm, 4) : null, ctr: mf.ctr != null ? round(mf.ctr, 5) : null,
      cpc: s.cliquesLink > 0 ? round(s.gasto / s.cliquesLink, 4) : null,
      custo_msg: s.conversasMeta > 0 ? round(s.gasto / s.conversasMeta, 4) : null,
      custo_lead: s.leads > 0 ? round(s.gasto / s.leads, 4) : null,
      cps: s.sess > 0 ? round(s.gasto / s.sess, 4) : null,
      rps: s.sess > 0 ? round(f.receitaLiq / s.sess, 4) : null,
      par: mf.par != null ? round(mf.par, 3) : null, ecpm: mf.ecpm != null ? round(mf.ecpm, 2) : null,
      cliques_bot_lead: s.leads > 0 ? round(s.cliquesAd / s.leads, 2) : null,
      chegada: mf.chegada != null ? round(mf.chegada, 3) : null,
      spl: s.leads > 0 ? round(s.sess / s.leads, 2) : null,
    },
    gargalo: g ? { chave: g.chave, label: g.label, fator: g.fator, delta: g.delta, classe: g.classe, piso_falha: g.piso_falha } : null,
    potencial: potencial(roasFinal, g, cfg),
    veredito: veredito(roasFinal, s.gasto, s.numDias, cfg),
    vazamento,
    validacao: validar(f, cfg),
  };
}

// linha de validação (reconstruído vs direto)
function validar(f, cfg) {
  const recon = roasReconstruido(f, Number(cfg.taxa_gam));
  const direto = f.roas;
  const div = (recon != null && direto) ? Math.abs(recon - direto) / direto : null;
  return { reconstruido: round(recon, 3), direto: round(direto, 3), divergencia: round(div, 4) };
}

// ── Medianas 7d do domínio: mediana temporal dos agregados diários ─────────
// diasRows = linhas (conjunto×dia) dos últimos N dias fechados do domínio.
// Para cada dia, agrega o domínio inteiro e calcula os 4 fatores; a mediana desses fatores é a referência.
function medianas7d(diasRows, taxa) {
  const porDia = new Map();
  for (const l of diasRows) {
    if (!l.data) continue;
    if (!porDia.has(l.data)) porDia.set(l.data, []);
    porDia.get(l.data).push(l);
  }
  const cols = { custo_lead: [], spl: [], par: [], ecpm: [],
    cpm: [], ctr: [], anuncio_lead: [], chegada: [], engajamento: [] };
  for (const linhas of porDia.values()) {
    const s = somar(linhas);
    const f = fatores(s, taxa), mf = metricasFinas(s);
    const all = { ...f, ...mf };
    for (const k of Object.keys(cols)) if (all[k] != null && isFinite(all[k])) cols[k].push(all[k]);
  }
  const out = { _amostraDias: porDia.size };
  for (const k of Object.keys(cols)) out[k] = mediana(cols[k]);
  return out;
}

// ── Classificação sistêmico × local de um gargalo, na população de conjuntos ──
// conjuntos = array de diagnósticos de conjunto (já rodados). Para a chave do gargalo,
// conta quantos conjuntos (e quanto gasto) têm ESSE fator como seu gargalo.
function classificarGargalo(chave, conjuntos, cfg) {
  const ativos = conjuntos.filter(c => c.gargalo);
  if (!ativos.length) return null;
  const afetados = ativos.filter(c => c.gargalo.chave === chave);
  const gastoTot = ativos.reduce((a, c) => a + c.gasto, 0);
  const gastoAf = afetados.reduce((a, c) => a + c.gasto, 0);
  const pctConj = afetados.length / ativos.length;
  const pctGasto = gastoTot > 0 ? gastoAf / gastoTot : 0;
  const sistemico = Math.max(pctConj, pctGasto) >= Number(cfg.sistemico_pct);
  return {
    chave, classe: sistemico ? 'SISTEMICO' : 'LOCAL',
    conjuntos_afetados: afetados.length, conjuntos_ativos: ativos.length,
    pct_conjuntos: round(pctConj, 3), pct_gasto: round(pctGasto, 3),
  };
}

// ── util ───────────────────────────────────────────────────────────────────
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function round(v, d = 2) { if (v == null || !isFinite(v)) return null; const p = 10 ** d; return Math.round(v * p) / p; }
function mediana(arr) {
  if (!arr || !arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function f2(v) { return (v == null ? '–' : Number(v).toFixed(2)); }
function fmtBRL(v) { return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

module.exports = {
  FATORES, FUNIL_FINO, CFG_PADRAO,
  somar, fatores, metricasFinas, funilNos, roasReconstruido, nos, gargalo, potencial, veredito,
  diagnosticarConjunto, medianas7d, classificarGargalo, mediana, round,
};
