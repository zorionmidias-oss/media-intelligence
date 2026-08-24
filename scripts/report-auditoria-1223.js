'use strict';
// Auditoria 12–23/06/2026 — AFS, SN, BR.
// Gera 2 CSVs: (1) diario por pais x data x UTM x campanha; (2) horario agregado por dominio.
// Limitacoes do banco: conjunto nunca gravado; horario so existe agregado por dominio (sem UTM/campanha).
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const D1 = '2026-06-12', D2 = '2026-06-23';
const PAISES = ['AFS', 'SN', 'BR'];
const OUTDIR = path.join(__dirname, '..', 'reports');

const DOM_NOME = { 0: 'GLOBAL (todos os dominios)', 1: 'mkuker.com', 2: 'euro.mkuker.com', 3: 'eu.mkuker.com', 4: 'app.mkuker.com' };
const DOM_PAISES = { 0: 'todos', 1: 'AFS + SN + GH (misturados)', 2: 'SN', 3: 'CZ', 4: 'BR' };

async function fetchAll(builderFn) {
  const PAGE = 1000; let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await builderFn().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data);
    if (data.length < PAGE) break;
  }
  return all;
}

const n = (x) => Number(x || 0);
// PT-BR: separador ';' e decimal ','
function num(x, dec) {
  if (x === null || x === undefined || x === '') return '';
  const v = Number(x);
  if (Number.isNaN(v)) return '';
  const s = dec === undefined ? String(v) : v.toFixed(dec);
  return s.replace('.', ',');
}
function txt(x) {
  if (x === null || x === undefined) return '';
  const s = String(x);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, rows) {
  const lines = [header.join(';')];
  for (const r of rows) lines.push(r.join(';'));
  fs.writeFileSync(file, '﻿' + lines.join('\r\n'), 'utf8');
}

async function main() {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

  // ───────────────────────── 1) DIARIO por pais x data x UTM x campanha ─────────────────────────
  const diario = await fetchAll(() =>
    sb.from('ads_consolidados').select('*')
      .in('pais_sigla', PAISES).gte('data', D1).lte('data', D2)
  );
  diario.sort((a, b) =>
    a.pais_sigla.localeCompare(b.pais_sigla) ||
    a.data.localeCompare(b.data) ||
    n(b.valor_gasto) - n(a.valor_gasto) ||
    String(a.ad_utm).localeCompare(String(b.ad_utm))
  );

  const headD = [
    'pais_sigla', 'pais_nome', 'data', 'ad_utm', 'campanha_meta', 'conjunto_meta', 'tipo', 'objetivo',
    'status_inferido', 'moeda_original', 'taxa_usd_aplicada', 'imposto_aplicado_%',
    'investimento_brl', 'investimento_original',
    'resultado', 'custo_resultado_brl', 'cpc_meta', 'ctr_meta_%', 'cliques_meta', 'conversas_meta', 'sessoes_meta',
    'impressoes_gam', 'cliques_gam', 'cpc_gam', 'ctr_gam_%', 'viewability_%', 'ecpm',
    'rps', 'faturamento_bruto', 'faturamento_liquido', 'lucro', 'roas',
    'orcamento_total', 'account_id', 'dominio_id', 'updated_at'
  ];
  const rowsD = diario.map(r => [
    txt(r.pais_sigla), txt(r.pais_nome), txt(r.data), txt(r.ad_utm), txt(r.campanha_meta), txt(r.conjunto_meta),
    txt(r.tipo), txt(r.objetivo),
    n(r.valor_gasto) > 0 ? 'ativo' : 'sem gasto', txt(r.moeda_original), num(r.taxa_usd_aplicada, 4), num(r.imposto_aplicado, 2),
    num(r.valor_gasto, 2), num(r.valor_gasto_original, 2),
    n(r.resultado), num(r.custo_resultado, 2), num(r.cpc, 4), num(r.ctr, 2), n(r.cliques), n(r.conversas_meta), n(r.sessoes_meta),
    n(r.impressoes_gam), n(r.cliques_gam), num(r.cpc_gam, 4), num(r.ctr_gam, 2), num(r.viewability, 2), num(r.ecpm, 2),
    num(r.rps, 4), num(r.faturamento_bruto, 2), num(r.faturamento_real, 2), num(r.lucro, 2), num(r.roas, 4),
    num(r.orcamento_total, 2), txt(r.account_id), txt(r.dominio_id), txt(r.updated_at)
  ]);
  const fileD = path.join(OUTDIR, 'auditoria_12-23jun_DIARIO_utm-campanha.csv');
  writeCsv(fileD, headD, rowsD);

  // ───────────────────────── 2) HORARIO agregado por dominio ─────────────────────────
  const dh = await fetchAll(() =>
    sb.from('dados_hora').select('*').gte('data', D1).lte('data', D2)
  );
  const rh = await fetchAll(() =>
    sb.from('report_hora').select('*').gte('data', D1).lte('data', D2)
  );
  const rhMap = {};
  for (const r of rh) rhMap[`${r.data}|${r.hora}|${r.dominio_id}`] = r;

  dh.sort((a, b) =>
    (a.dominio_id - b.dominio_id) || a.data.localeCompare(b.data) || (a.hora - b.hora)
  );

  const headH = [
    'dominio_id', 'dominio_nome', 'paises_no_dominio', 'data', 'hora',
    'investimento_brl', 'receita_bruta_gam', 'receita_liquida', 'ecpm', 'roi_%', 'impressoes',
    'gam_receita_bruta', 'gam_ecpm', 'gam_impressoes', 'gam_nao_preenchidas', 'gam_cliques', 'gam_ctr', 'gam_cpc'
  ];
  const rowsH = dh.map(r => {
    const g = rhMap[`${r.data}|${r.hora}|${r.dominio_id}`] || {};
    return [
      txt(r.dominio_id), txt(DOM_NOME[r.dominio_id] ?? '?'), txt(DOM_PAISES[r.dominio_id] ?? '?'),
      txt(r.data), txt(r.hora),
      num(r.investimento_brl, 2), num(r.receita_bruta, 2), num(r.receita_liquida, 2), num(r.ecpm, 2), num(r.roi, 2), n(r.impressoes),
      num(g.receita, 2), num(g.ecpm, 2), g.impressoes ?? '', g.nao_preenchidas ?? '', g.cliques ?? '', num(g.ctr, 2), num(g.cpc, 4)
    ];
  });
  const fileH = path.join(OUTDIR, 'auditoria_12-23jun_HORARIO_por-dominio.csv');
  writeCsv(fileH, headH, rowsH);

  // ───────────────────────── Resumo no console ─────────────────────────
  const byPais = {};
  for (const r of diario) {
    const p = byPais[r.pais_sigla] = byPais[r.pais_sigla] || { rows: 0, gasto: 0, fat: 0, datas: new Set(), utms: new Set() };
    p.rows++; p.gasto += n(r.valor_gasto); p.fat += n(r.faturamento_real); p.datas.add(r.data); p.utms.add(r.ad_utm);
  }
  console.log('=== DIARIO ===');
  for (const [p, v] of Object.entries(byPais))
    console.log(`${p}: ${v.rows} linhas | ${v.datas.size} dias | ${v.utms.size} UTMs | gasto R$ ${v.gasto.toFixed(2)} | fat.liq R$ ${v.fat.toFixed(2)} | lucro R$ ${(v.fat - v.gasto).toFixed(2)}`);
  console.log(`Total diario: ${rowsD.length} linhas -> ${fileD}`);
  console.log('=== HORARIO ===');
  console.log(`${rowsH.length} linhas (${dh.length} dados_hora x match report_hora) -> ${fileH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
