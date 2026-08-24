'use strict';
const supabase = require('../src/lib/supabase');
const { fetchAll } = require('../src/lib/fetchAll');
const { hojeBR, diasAtrasBR } = require('../src/lib/datas');

const brl = n => 'R$' + Number(n || 0).toFixed(2);

(async () => {
  const d20 = diasAtrasBR(20);

  const { data: ads, error: e1 } = await fetchAll(() => supabase.from('ads_consolidados')
    .select('data,ad_utm,account_id,dominio_id,pais_sigla,valor_gasto,faturamento_real,faturamento_bruto,gam_match,campaign_id,sessoes_meta,manually_fixed')
    .gte('data', d20).order('data', { ascending: false }));
  if (e1) console.log('ERRO ads:', e1.message);
  console.log('=== ads_consolidados por dia total=' + ads.length + ' ===');
  console.log('data        linhas contas gasto        receitaLiq   match id/nome/id+nome/null   gasto>=5&semReceita');
  const byDay = {};
  for (const r of ads) (byDay[r.data] ||= []).push(r);
  for (const d of Object.keys(byDay).sort().reverse()) {
    const rs = byDay[d];
    const accs = new Set(rs.map(r => r.account_id)).size;
    const g = rs.reduce((s, r) => s + Number(r.valor_gasto || 0), 0);
    const f = rs.reduce((s, r) => s + Number(r.faturamento_real || 0), 0);
    const m = { id: 0, nome: 0, 'id+nome': 0, null: 0 };
    rs.forEach(r => m[r.gam_match || 'null']++);
    const semRec = rs.filter(r => Number(r.valor_gasto || 0) >= 5 && !Number(r.faturamento_real || 0)).length;
    const semCamp = rs.filter(r => !r.campaign_id).length;
    console.log(`${d}  ${String(rs.length).padStart(5)}  ${accs}     ${brl(g).padEnd(12)} ${brl(f).padEnd(12)} ${m.id}/${m.nome}/${m['id+nome']}/${m.null}`.padEnd(88) + `  ${semRec}   semCampaignId=${semCamp}`);
  }

  const { data: rec, error: e2 } = await fetchAll(() => supabase.from('receita_ads')
    .select('data,ad_id,ad_utm,campaign_id,page_id,receita_bruta').gte('data', d20));
  if (e2) console.log('ERRO receita_ads:', e2.message);
  const rByDay = {};
  for (const r of rec) (rByDay[r.data] ||= []).push(r);
  console.log('\n=== receita_ads por dia total=' + rec.length + ' ===');
  for (const d of Object.keys(rByDay).sort().reverse()) {
    const rs = rByDay[d];
    console.log(`${d}  linhas=${String(rs.length).padStart(4)}  bruta=${brl(rs.reduce((s, r) => s + Number(r.receita_bruta || 0), 0)).padEnd(12)} semCampaignId=${rs.filter(r => !r.campaign_id).length}  semPageId=${rs.filter(r => !r.page_id).length}`);
  }

  const { data: blocos, error: e3 } = await fetchAll(() => supabase.from('blocos_anuncio')
    .select('data,dominio_id,receita_total').gte('data', d20));
  if (e3) console.log('ERRO blocos:', e3.message);
  const bByDay = {};
  for (const r of blocos) (bByDay[r.data] ||= []).push(r);
  console.log('\n=== blocos_anuncio por dia total=' + blocos.length + ' ===');
  for (const d of Object.keys(bByDay).sort().reverse()) {
    const rs = bByDay[d];
    const br = rs.reduce((s, r) => s + Number(r.receita_total || 0), 0);
    console.log(`${d}  linhas=${String(rs.length).padStart(3)}  bruta=${brl(br).padEnd(12)} liq(x0.9)=${brl(br * 0.9).padEnd(12)} dominios=${new Set(rs.map(r => r.dominio_id)).size}`);
  }

  // comparação receita: blocos (verdade) vs ads_consolidados (atribuída) vs receita_ads
  console.log('\n=== RECEITA: blocos vs receita_ads vs ads_consolidados (liq) ===');
  const dias = [...new Set([...Object.keys(bByDay), ...Object.keys(rByDay), ...Object.keys(byDay)])].sort().reverse();
  for (const d of dias) {
    const b = (bByDay[d] || []).reduce((s, r) => s + Number(r.receita_total || 0), 0) * 0.9;
    const ra = (rByDay[d] || []).reduce((s, r) => s + Number(r.receita_bruta || 0), 0) * 0.9;
    const ac = (byDay[d] || []).reduce((s, r) => s + Number(r.faturamento_real || 0), 0);
    const pct = b ? ((ac / b) * 100).toFixed(0) + '%' : '—';
    console.log(`${d}  blocos=${brl(b).padEnd(12)} receita_ads=${brl(ra).padEnd(12)} ads_consol=${brl(ac).padEnd(12)} atribuicao=${pct}`);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
