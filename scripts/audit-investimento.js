'use strict';
// Auditoria do investimento: DB (ads_consolidados) × Meta API, com re-bucketing BR.
const axios = require('axios');
const { DateTime } = require('luxon');
const supabase = require('../src/lib/supabase');
const { fetchAll } = require('../src/lib/fetchAll');
const BASE = 'https://graph.facebook.com/v19.0';

function converterHoraParaBR(dateStr, horaField, accountTz) {
  const hh = (horaField || '').slice(0, 8);
  if (!hh || hh.length < 5) return null;
  const dt = DateTime.fromISO(`${dateStr}T${hh}`, { zone: accountTz });
  if (!dt.isValid) return null;
  return dt.setZone('America/Sao_Paulo').toISODate();
}

const DIAS = Number(process.argv[2] || 10);
const hoje = DateTime.now().setZone('America/Sao_Paulo');
const until = hoje.minus({ days: 1 }).toISODate();          // só dias FECHADOS
const since = hoje.minus({ days: DIAS }).toISODate();

(async () => {
  console.log(`Período (dias fechados, fuso BR): ${since} → ${until}\n`);

  const { data: accs } = await supabase.from('meta_accounts')
    .select('ad_account_id,nome,access_token,moeda,imposto_percentual,timezone_name').eq('ativo', true);

  // ── 1) DB: soma por dia e por conta
  const { data: dbRows, error: dbErr } = await fetchAll(() =>
    supabase.from('ads_consolidados')
      .select('data,account_id,valor_gasto,valor_gasto_original,taxa_usd_aplicada')
      .gte('data', since).lte('data', until)
  );
  if (dbErr) throw new Error('ads_consolidados: ' + dbErr.message);
  const dbDia = {}, dbConta = {};
  for (const r of dbRows) {
    dbDia[r.data] = (dbDia[r.data] || 0) + Number(r.valor_gasto || 0);
    const k = r.account_id;
    (dbConta[k] ||= { gasto: 0, orig: 0 });
    dbConta[k].gasto += Number(r.valor_gasto || 0);
    dbConta[k].orig  += Number(r.valor_gasto_original || 0);
  }
  console.log(`linhas em ads_consolidados: ${dbRows.length}`);

  // ── 2) Meta: gasto horário re-bucketado p/ dia BR
  const metaDia = {}, metaConta = {};
  for (const acc of accs) {
    if (!acc.access_token) { console.log(`  ${acc.nome}: SEM TOKEN`); continue; }
    const tz = acc.timezone_name || 'America/Sao_Paulo';
    // margem de 1 dia dos dois lados p/ o re-bucketing pegar as bordas
    const s = DateTime.fromISO(since).minus({ days: 1 }).toISODate();
    const u = DateTime.fromISO(until).plus({ days: 1 }).toISODate();
    let url = `${BASE}/${acc.ad_account_id}/insights`;
    let params = {
      access_token: acc.access_token, level: 'account', time_increment: 1, limit: 500,
      breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
      fields: 'spend,date_start',
      time_range: JSON.stringify({ since: s, until: u }),
    };
    let n = 0;
    for (let pg = 0; pg < 40; pg++) {
      let r;
      try { r = await axios.get(url, { params }); }
      catch (e) { console.log(`  ${acc.nome}: ERRO ${e.response?.data?.error?.message || e.message}`); break; }
      for (const row of (r.data.data || [])) {
        const dBR = converterHoraParaBR(row.date_start, row.hourly_stats_aggregated_by_advertiser_time_zone, tz);
        if (!dBR || dBR < since || dBR > until) continue;
        const spend = Number(row.spend || 0);
        if (!spend) continue;
        n++;
        metaConta[acc.ad_account_id] = (metaConta[acc.ad_account_id] || 0) + spend;
        // converte p/ BRL com a MESMA taxa que o DB usou naquele dia
        metaDia[dBR] = (metaDia[dBR] || 0) + spend;
      }
      const nx = r.data.paging?.next; if (!nx) break; url = nx; params = {};
    }
    console.log(`  ${acc.nome} (${tz}, ${acc.moeda}, imp ${acc.imposto_percentual}%): ${n} linhas horárias`);
  }

  // ── 3) Comparação do BRUTO (moeda da conta) por conta
  console.log('\n=== GASTO BRUTO (moeda da conta): DB vs META ===');
  let okBruto = true;
  for (const acc of accs) {
    const k = acc.ad_account_id;
    const db = dbConta[k]?.orig || 0, mt = metaConta[k] || 0;
    const dif = mt ? ((db - mt) / mt) * 100 : (db ? 100 : 0);
    if (Math.abs(dif) > 1) okBruto = false;
    console.log(`${(acc.nome||k).padEnd(10)} DB=${db.toFixed(2).padStart(10)}  META=${mt.toFixed(2).padStart(10)}  dif=${dif.toFixed(2)}%`);
  }

  // ── 4) Fórmula linha a linha: valor_gasto == original × taxa × (1+imp)
  console.log('\n=== FÓRMULA valor_gasto = original × taxa × (1+imposto) ===');
  const impPorConta = {}; for (const a of accs) impPorConta[a.ad_account_id] = Number(a.imposto_percentual || 0);
  let ruins = 0, checadas = 0;
  for (const r of dbRows) {
    const orig = Number(r.valor_gasto_original || 0), taxa = Number(r.taxa_usd_aplicada || 0);
    if (!orig || !taxa) continue;
    checadas++;
    const esperado = orig * taxa * (1 + (impPorConta[r.account_id] || 0) / 100);
    if (Math.abs(esperado - Number(r.valor_gasto || 0)) > 0.02) {
      if (ruins < 5) console.log(`  ✗ ${r.data} ${r.account_id}: gravado=${Number(r.valor_gasto).toFixed(2)} esperado=${esperado.toFixed(2)}`);
      ruins++;
    }
  }
  console.log(`  ${checadas - ruins}/${checadas} linhas conferem${ruins ? ` — ${ruins} divergentes` : ' ✓'}`);

  // ── 5) Por dia (BRL no DB)
  console.log('\n=== INVESTIMENTO POR DIA (BRL, como o dash mostra) ===');
  const dias = [...new Set([...Object.keys(dbDia), ...Object.keys(metaDia)])].sort();
  let totDB = 0;
  for (const d of dias) { totDB += dbDia[d] || 0;
    console.log(`${d}  DB=R$ ${(dbDia[d]||0).toFixed(2).padStart(9)}   (bruto META ${(metaDia[d]||0).toFixed(2).padStart(9)} ${accs[0]?.moeda||''})`); }
  console.log(`\nTOTAL DB no período: R$ ${totDB.toFixed(2)}`);
  console.log(okBruto ? '\n✓ Bruto bate com a Meta (dif <1% por conta)' : '\n⚠ Bruto DIVERGE em alguma conta — ver acima');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
