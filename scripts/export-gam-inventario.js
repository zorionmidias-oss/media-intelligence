'use strict';
/*
 * Export GAM de INVENTÁRIO (nível bloco de anúncio × dia) — companheiro do export por conjunto.
 *
 * IMPORTANTE: solicitações de anúncio, fill rate e Active View viewability são métricas de
 * INVENTÁRIO (acontecem no carregamento da página do blog, independentemente de qual conjunto
 * Meta mandou o usuário). Não são atribuíveis por conjunto de anúncio por design. Este CSV traz
 * o que o sistema persiste hoje em blocos_anuncio: impressões, cliques, receita, eCPM e taxa de
 * correspondência programática (proxy de fill) por bloco/dia. Viewability real por bloco e
 * "ad requests"/"unfilled" exigem um relatório GAM dedicado (Active View) — dá pra adicionar.
 *
 * Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/export-gam-inventario.js [SINCE] [UNTIL]
 */
const fs = require('fs');
const path = require('path');
const supabase = require('../src/lib/supabase');
const { fetchAll } = require('../src/lib/fetchAll');
const { hojeBR } = require('../src/lib/datas');

const SINCE = process.argv[2] || '2026-07-22';
const UNTIL = process.argv[3] || hojeBR();
const OUT_DIR = path.join(__dirname, '..', 'exports');

function toCSV(rows, cols) {
  const esc = (v) => { if (v == null) return ''; const s = String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\n') + '\n';
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { data: doms } = await supabase.from('dominios').select('id,nome');
  const domName = {}; (doms || []).forEach(d => domName[d.id] = d.nome);

  const { data, error } = await fetchAll(() =>
    supabase.from('blocos_anuncio')
      .select('data,dominio_id,nome_bloco,impressoes,total_clicks,receita_total,ecpm_medio,taxa_correspondencia_programatica')
      .gte('data', SINCE).lte('data', UNTIL)
  );
  if (error) { console.error(error.message); process.exit(1); }

  const out = data.map(r => ({
    data: r.data,
    dominio: domName[r.dominio_id] || r.dominio_id,
    nome_bloco: r.nome_bloco,
    impressoes: r.impressoes,
    cliques: r.total_clicks,
    receita_bruta: r.receita_total,
    receita_liquida: +(Number(r.receita_total || 0) * 0.9).toFixed(2),
    ecpm: r.ecpm_medio,
    taxa_correspondencia_programatica: r.taxa_correspondencia_programatica,
  })).sort((a, b) => (a.data + a.dominio + a.nome_bloco).localeCompare(b.data + b.dominio + b.nome_bloco));

  const cols = ['data','dominio','nome_bloco','impressoes','cliques','receita_bruta','receita_liquida','ecpm','taxa_correspondencia_programatica'];
  fs.writeFileSync(path.join(OUT_DIR, 'gam_inventario.csv'), toCSV(out, cols));
  console.log(`[gam-inv] → exports/gam_inventario.csv (${out.length} linhas, ${SINCE}→${UNTIL})`);
})().catch(e => { console.error(e); process.exit(1); });
