'use strict';
// Blocos de anuncio (GAM) — impressoes, PMR e metricas, 13 a 23/06/2026.
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OUTDIR = path.join(__dirname, '..', 'reports');
const DOM_NOME = { 0: 'GLOBAL', 1: 'mkuker.com', 2: 'euro.mkuker.com', 3: 'eu.mkuker.com', 4: 'app.mkuker.com' };
const n = (x) => Number(x || 0);

function txt(x) { if (x == null) return ''; const s = String(x); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function num(x, dec) { if (x == null || x === '') return ''; const v = Number(x); if (Number.isNaN(v)) return ''; return (dec === undefined ? String(v) : v.toFixed(dec)).replace('.', ','); }

async function fetchAll(fn) {
  const P = 1000; let all = [];
  for (let f = 0; ; f += P) { const { data, error } = await fn().range(f, f + P - 1); if (error) throw new Error(error.message); all = all.concat(data); if (data.length < P) break; }
  return all;
}

async function main() {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
  const blocos = await fetchAll(() =>
    sb.from('blocos_anuncio').select('*').gte('data', '2026-06-13').lte('data', '2026-06-23')
  );
  blocos.sort((a, b) => a.data.localeCompare(b.data) || (a.dominio_id - b.dominio_id) || n(b.impressoes) - n(a.impressoes));

  const head = ['data', 'dominio_id', 'dominio_nome', 'nome_bloco', 'impressoes', 'total_clicks', 'ctr_%', 'receita_total', 'ecpm_medio', 'pmr_taxa_corresp_programatica_%', 'updated_at'];
  const rows = blocos.map(r => {
    const ctr = n(r.impressoes) ? n(r.total_clicks) / n(r.impressoes) * 100 : 0;
    return [
      txt(r.data), txt(r.dominio_id), txt(DOM_NOME[r.dominio_id] ?? '?'), txt(r.nome_bloco),
      n(r.impressoes), n(r.total_clicks), num(ctr, 2), num(r.receita_total, 2), num(r.ecpm_medio, 2),
      num(r.taxa_correspondencia_programatica, 2), txt(r.updated_at)
    ];
  });
  const file = path.join(OUTDIR, 'blocos_impressoes_pmr_13-23jun.csv');
  fs.writeFileSync(file, '﻿' + [head.join(';'), ...rows.map(r => r.join(';'))].join('\r\n'), 'utf8');

  // resumo por dominio
  const byDom = {};
  for (const r of blocos) {
    const d = byDom[r.dominio_id] = byDom[r.dominio_id] || { imp: 0, clk: 0, rec: 0, pmrSum: 0, pmrN: 0, n: 0 };
    d.imp += n(r.impressoes); d.clk += n(r.total_clicks); d.rec += n(r.receita_total); d.n++;
    if (r.taxa_correspondencia_programatica != null) { d.pmrSum += n(r.taxa_correspondencia_programatica); d.pmrN++; }
  }
  console.log(`${rows.length} linhas -> ${file}\n`);
  console.log('Dominio'.padEnd(18), 'Linhas', 'Impressoes', 'Clicks', 'Receita', 'PMR medio');
  for (const [id, d] of Object.entries(byDom))
    console.log((DOM_NOME[id] || id).padEnd(18), String(d.n).padEnd(6), String(d.imp).padEnd(10), String(d.clk).padEnd(6), d.rec.toFixed(2).padEnd(9), (d.pmrN ? (d.pmrSum / d.pmrN).toFixed(2) + '%' : '—'));
}
main().catch(e => { console.error(e); process.exit(1); });
