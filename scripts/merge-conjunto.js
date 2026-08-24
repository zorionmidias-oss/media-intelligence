'use strict';
/*
 * Junta os exports por conjunto num único MASTER_por_conjunto.csv, chave = (data, adset_id).
 * Outer join: uma linha por conjunto×dia com métricas de Meta + GAM + bot + blog lado a lado.
 *
 * Lê de exports/: meta_por_conjunto.csv, gam_por_conjunto.csv, bot_blog_por_conjunto.csv
 * Uso: node scripts/merge-conjunto.js
 *
 * ATENÇÃO — moeda: `gasto` vem na moeda da conta Meta (USD nas contas USD, BRL na BRL).
 * `receita_gam_*` e `receita_estimada` estão em BRL. Por isso NÃO calculamos lucro aqui —
 * converter o gasto USD→BRL antes de subtrair (a coluna `conta` diz a origem).
 */
const fs = require('fs');
const path = require('path');
const OUT_DIR = path.join(__dirname, '..', 'exports');

function parseCSV(file) {
  const txt = fs.readFileSync(path.join(OUT_DIR, file), 'utf8').replace(/^﻿/, '');
  const lines = txt.split(/\r?\n/).filter(l => l.length);
  const cols = splitLine(lines[0]);
  return lines.slice(1).map(l => {
    const v = splitLine(l);
    const o = {};
    cols.forEach((c, i) => o[c] = v[i]);
    return o;
  });
}
function splitLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur);
  return out;
}
function toCSV(rows, cols) {
  const esc = (v) => { if (v == null || v === '') return ''; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n') + '\n';
}
const num = (v) => (v === '' || v == null) ? 0 : Number(v);

const meta = parseCSV('meta_por_conjunto.csv');
const gam = parseCSV('gam_por_conjunto.csv');
const bb = parseCSV('bot_blog_por_conjunto.csv');

const master = {};
const key = (d, a) => `${d}|${a}`;
function slot(d, a) {
  const k = key(d, a);
  return master[k] || (master[k] = { data: d, adset_id: a });
}

for (const r of meta) {
  const s = slot(r.data, r.adset_id);
  Object.assign(s, {
    conta: r.conta, campaign_id: r.campaign_id, campaign_name: r.campaign_name, adset_name: r.adset_name,
    gasto: r.gasto, moeda_conta_ver_readme: '', impressoes_meta: r.impressoes, alcance: r.alcance,
    frequencia: r.frequencia, cpm: r.cpm, cliques_link: r.cliques_link, ctr_link: r.ctr_link,
    cpc_link: r.cpc_link, conversas: r.conversas, custo_conversa: r.custo_conversa,
    status_atual: r.status_atual, orcamento_diario_atual: r.orcamento_diario_atual,
  });
}
for (const r of gam) {
  const s = slot(r.data, r.adset_id);
  if (!s.campaign_id) s.campaign_id = r.campaign_id;
  Object.assign(s, {
    receita_gam_bruta: r.receita_gam_bruta, receita_gam_liquida: r.receita_gam_liquida,
    impressoes_gam: r.impressoes_gam, cliques_gam: r.cliques_gam, ecpm_gam: r.ecpm_gam,
  });
}
for (const r of bb) {
  const s = slot(r.data, r.adset_id);
  if (!s.adset_name) s.adset_name = r.adset_name;
  if (!s.campaign_id) s.campaign_id = r.campaign_id;
  Object.assign(s, {
    leads_entrada: r.leads_entrada, cliques_ad: r.cliques_ad, threads: r.threads,
    leads_qualificados: r.leads_qualificados, leads_avaliados: r.leads_avaliados,
    receita_estimada_brl: r.receita_estimada, sessoes: r.sessoes, leads_com_sessao: r.leads_com_sessao,
  });
}

// derivadas seguras (sem cruzar moeda)
for (const s of Object.values(master)) {
  const le = num(s.leads_entrada), ls = num(s.leads_com_sessao), sess = num(s.sessoes), lq = num(s.leads_qualificados), la = num(s.leads_avaliados);
  s.gap_clique_sessao = le - ls;              // leads que clicaram no bot mas não abriram sessão no blog
  s.pct_chegada_blog = le > 0 ? +(ls / le * 100).toFixed(1) : '';
  s.sessoes_por_lead = ls > 0 ? +(sess / ls).toFixed(2) : '';
  s.taxa_qualificacao = la > 0 ? +(lq / la * 100).toFixed(1) : '';
}

const cols = [
  'data', 'conta', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
  // Meta
  'gasto', 'impressoes_meta', 'alcance', 'frequencia', 'cpm', 'cliques_link', 'ctr_link', 'cpc_link',
  'conversas', 'custo_conversa', 'status_atual', 'orcamento_diario_atual',
  // Bot
  'leads_entrada', 'cliques_ad', 'threads', 'leads_qualificados', 'leads_avaliados', 'receita_estimada_brl',
  // Blog
  'sessoes', 'leads_com_sessao', 'gap_clique_sessao', 'pct_chegada_blog', 'sessoes_por_lead', 'taxa_qualificacao',
  // GAM
  'receita_gam_bruta', 'receita_gam_liquida', 'impressoes_gam', 'cliques_gam', 'ecpm_gam',
];

const rows = Object.values(master).sort((a, b) => (a.data + a.adset_id).localeCompare(b.data + b.adset_id));
fs.writeFileSync(path.join(OUT_DIR, 'MASTER_por_conjunto.csv'), toCSV(rows, cols));
console.log(`[merge] → exports/MASTER_por_conjunto.csv (${rows.length} linhas conjunto×dia)`);
console.log(`  fontes: meta=${meta.length} gam=${gam.length} bot_blog=${bb.length}`);
