'use strict';
// Ensaio da poda: lista o que seria removido, comparando DB × Meta (nivel anuncio).
const axios = require('axios');
const { DateTime } = require('luxon');
const supabase = require('../src/lib/supabase');
const { fetchAll } = require('../src/lib/fetchAll');
const BASE = 'https://graph.facebook.com/v19.0';
function toBR(d, h, tz) {
  const hh = (h || '').slice(0, 8); if (!hh || hh.length < 5) return null;
  const dt = DateTime.fromISO(`${d}T${hh}`, { zone: tz });
  return dt.isValid ? dt.setZone('America/Sao_Paulo').toISODate() : null;
}
const DIAS = Number(process.argv[2] || 10);
(async () => {
  const hoje = DateTime.now().setZone('America/Sao_Paulo');
  const until = hoje.toISODate(), since = hoje.minus({ days: DIAS }).toISODate();
  console.log(`Ensaio da poda — ${since} → ${until}\n`);
  const { data: accs } = await supabase.from('meta_accounts')
    .select('ad_account_id,nome,access_token,timezone_name').eq('ativo', true);
  const { data: dbRows } = await fetchAll(() => supabase.from('ads_consolidados')
    .select('id,data,account_id,ad_utm,valor_gasto,manually_fixed')
    .gte('data', since).lte('data', until));

  let totLinhas = 0, totValor = 0;
  for (const acc of accs) {
    if (!acc.access_token) continue;
    const tz = acc.timezone_name || 'America/Sao_Paulo';
    const vivos = {};   // data → Set(ad_name)
    let url = `${BASE}/${acc.ad_account_id}/insights`;
    let params = { access_token: acc.access_token, level: 'ad', time_increment: 1, limit: 500,
      breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone', fields: 'spend,date_start,ad_name',
      time_range: JSON.stringify({ since: DateTime.fromISO(since).minus({days:1}).toISODate(),
                                   until: DateTime.fromISO(until).plus({days:1}).toISODate() }) };
    let erro = null;
    for (let p = 0; p < 60; p++) {
      let r; try { r = await axios.get(url, { params }); }
      catch (e) { erro = e.response?.data?.error?.message || e.message; break; }
      for (const row of (r.data.data || [])) {
        const d = toBR(row.date_start, row.hourly_stats_aggregated_by_advertiser_time_zone, tz);
        if (!d || !Number(row.spend || 0)) continue;
        (vivos[d] ||= new Set()).add(String(row.ad_name || '').toLowerCase());
      }
      const nx = r.data.paging?.next; if (!nx) break; url = nx; params = {};
    }
    if (erro) { console.log(`### ${acc.nome}: ERRO (${erro}) — poda pularia esta conta\n`); continue; }

    const meus = dbRows.filter(r => r.account_id === acc.ad_account_id);
    const orfas = meus.filter(r => vivos[r.data] && !r.manually_fixed
      && !vivos[r.data].has(String(r.ad_utm || '').toLowerCase()));
    if (!orfas.length) { console.log(`### ${acc.nome}: nada a podar ✓`); continue; }
    const porDia = {};
    for (const o of orfas) { (porDia[o.data] ||= []).push(o); }
    console.log(`### ${acc.nome}: ${orfas.length} órfã(s)`);
    for (const d of Object.keys(porDia).sort()) {
      const v = porDia[d].reduce((s, r) => s + Number(r.valor_gasto || 0), 0);
      console.log(`  ${d}  ${String(porDia[d].length).padStart(2)} linha(s)  R$ ${v.toFixed(2).padStart(9)}  ${porDia[d].slice(0,5).map(r=>r.ad_utm).join(', ')}`);
      totLinhas += porDia[d].length; totValor += v;
    }
    console.log('');
  }
  console.log(`\n>>> TOTAL A PODAR: ${totLinhas} linha(s), R$ ${totValor.toFixed(2)} de gasto fantasma`);
  console.log('    (nada foi apagado — isto é só o ensaio)');
})().catch(e => console.error('FATAL', e.message));
