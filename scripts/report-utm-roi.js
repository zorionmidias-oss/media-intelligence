'use strict';
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DIAS = ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];

async function fetchAll(builderFn) {
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await builderFn().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all = all.concat(data);
    if (data.length < PAGE) break;
  }
  return all;
}

function roi(fat, spend) {
  if (!spend) return null;
  return ((fat - spend) / spend) * 100;
}

function fmt(v) {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

async function main() {
  // Janela do relatório (09–12) com receita
  const janela = await fetchAll(() =>
    sb.from('ads_consolidados')
      .select('data,ad_utm,pais_sigla,valor_gasto,faturamento_real')
      .in('data', DIAS)
  );

  // Histórico completo (dias com gasto) p/ contar dias ativos
  const historico = await fetchAll(() =>
    sb.from('ads_consolidados')
      .select('data,ad_utm,pais_sigla,valor_gasto')
      .gt('valor_gasto', 0)
  );

  const diasAtivos = {}; // pais|utm -> Set(datas)
  for (const r of historico) {
    const k = `${r.pais_sigla || '?'}|${r.ad_utm}`;
    (diasAtivos[k] = diasAtivos[k] || new Set()).add(r.data);
  }

  const utms = {}; // pais|utm -> { porDia: {data:{spend,fat}} }
  for (const r of janela) {
    const k = `${r.pais_sigla || '?'}|${r.ad_utm}`;
    const u = (utms[k] = utms[k] || { pais: r.pais_sigla || '?', utm: r.ad_utm, porDia: {} });
    const d = (u.porDia[r.data] = u.porDia[r.data] || { spend: 0, fat: 0 });
    d.spend += Number(r.valor_gasto || 0);
    d.fat += Number(r.faturamento_real || 0);
  }

  const rows = Object.entries(utms).map(([k, u]) => {
    const w = DIAS.slice(0, 3).reduce(
      (a, d) => {
        const p = u.porDia[d] || { spend: 0, fat: 0 };
        return { spend: a.spend + p.spend, fat: a.fat + p.fat };
      },
      { spend: 0, fat: 0 }
    );
    const porDia = DIAS.map(d => {
      const p = u.porDia[d];
      return p && p.spend > 0 ? roi(p.fat, p.spend) : null;
    });
    return {
      pais: u.pais,
      utm: u.utm,
      diasAtivos: (diasAtivos[k] || new Set()).size,
      spend3d: w.spend,
      fat3d: w.fat,
      lucro3d: w.fat - w.spend,
      roi3d: roi(w.fat, w.spend),
      roi09: porDia[0],
      roi10: porDia[1],
      roi11: porDia[2],
      roi12: porDia[3],
    };
  });

  rows.sort((a, b) => a.pais.localeCompare(b.pais) || b.spend3d - a.spend3d);

  console.log(['Pais', 'UTM', 'DiasAtivos', 'Gasto3d(R$)', 'Fat3d(R$)', 'Lucro3d(R$)', 'ROI 3d (09-11)', 'ROI 09', 'ROI 10', 'ROI 11', 'ROI 12'].join('\t'));
  for (const r of rows) {
    console.log([
      r.pais, r.utm, r.diasAtivos,
      r.spend3d.toFixed(2), r.fat3d.toFixed(2), r.lucro3d.toFixed(2),
      fmt(r.roi3d), fmt(r.roi09), fmt(r.roi10), fmt(r.roi11), fmt(r.roi12),
    ].join('\t'));
  }
  const tot = rows.reduce((a, r) => ({ s: a.s + r.spend3d, f: a.f + r.fat3d }), { s: 0, f: 0 });
  console.log(`\nTOTAL 09-11: gasto R$ ${tot.s.toFixed(2)} | fat R$ ${tot.f.toFixed(2)} | lucro R$ ${(tot.f - tot.s).toFixed(2)} | ROI ${fmt(roi(tot.f, tot.s))}`);
  console.log(`Total de UTMs: ${rows.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
