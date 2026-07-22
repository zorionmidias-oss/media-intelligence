'use strict';
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const axios = require('axios');
const { google } = require('googleapis');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const supabase = require('../src/lib/supabase');
const { extractAdUTM } = require('../src/lib/parser');

const GAM_VERSION = 'v202605';
const SOAP_ENDPOINT = `https://ads.google.com/apis/ads/publisher/${GAM_VERSION}/ReportService`;
const NETWORK_CODE = process.env.GOOGLE_ADM_NETWORK_CODE;
const KEY_FILE = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON || './credentials/google-service-account.json';

const sep = (title) => console.log(`\n${'═'.repeat(60)}\n  ${title}\n${'═'.repeat(60)}`);

// ── GAM helpers ──────────────────────────────────────────────
async function gamToken() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/admanager'] });
  return (await (await auth.getClient()).getAccessToken()).token;
}
function wrap(nc, body) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header><ns1:RequestHeader xmlns:ns1="https://www.google.com/apis/ads/publisher/${GAM_VERSION}" soapenv:mustUnderstand="0"><ns1:networkCode>${nc}</ns1:networkCode><ns1:applicationName>audit</ns1:applicationName></ns1:RequestHeader></soapenv:Header><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}
function soap(token, xml) {
  return axios.post(SOAP_ENDPOINT, xml, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '', Authorization: `Bearer ${token}` },
    timeout: 30000,
  }).then(r => r.data);
}
function tag(xml, t) {
  const m = xml.match(new RegExp(`<(?:[\\w]+:)?${t}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${t}>`, 'i'));
  return m ? m[1].trim() : null;
}
function dateXML(d) {
  const [y, m, dd] = d.split('-');
  return `<year>${y}</year><month>${parseInt(m)}</month><day>${parseInt(dd)}</day>`;
}

// ── Main ─────────────────────────────────────────────────────
(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const since3 = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  // Use yesterday for API queries — Meta/GAM have no data at 2AM for "today"
  const apiDate = yesterday;

  // ──────────────────────────────────────────────────────────
  sep('1.1 — ads_consolidados últimos 3 dias');
  // ──────────────────────────────────────────────────────────
  const { data: adsDB, error: adsErr } = await supabase
    .from('ads_consolidados')
    .select('data,ad_utm,valor_gasto,cpc,ctr,faturamento_bruto,impressoes_gam,viewability,cliques,resultado')
    .gte('data', since3)
    .order('data', { ascending: false })
    .order('valor_gasto', { ascending: false })
    .limit(30);

  if (adsErr) console.error('ERRO supabase:', adsErr.message);
  console.log(`Total rows retornados: ${adsDB?.length || 0}\n`);
  console.log('data       | ad_utm                     | valor_gasto | cpc    | ctr   | fat_bruto | imp_gam | viewability | cliques | resultado');
  console.log('-'.repeat(130));
  for (const r of adsDB || []) {
    const pad = (v, n) => String(v ?? '').padEnd(n);
    console.log(`${pad(r.data,10)} | ${pad(r.ad_utm,26)} | ${pad(Number(r.valor_gasto||0).toFixed(2),11)} | ${pad(Number(r.cpc||0).toFixed(4),6)} | ${pad(Number(r.ctr||0).toFixed(2),5)} | ${pad(Number(r.faturamento_bruto||0).toFixed(2),9)} | ${pad(r.impressoes_gam,7)} | ${pad(Number(r.viewability||0).toFixed(2),11)} | ${pad(r.cliques,7)} | ${r.resultado}`);
  }

  // Coluna impressoes_meta existe?
  console.log('\n[verificando coluna impressoes_meta...]');
  const { data: colCheck } = await supabase.from('ads_consolidados').select('impressoes_meta').limit(1);
  if (colCheck === null) console.log('impressoes_meta: COLUNA NÃO EXISTE');
  else console.log('impressoes_meta: coluna existe →', colCheck[0]?.impressoes_meta ?? 'null');

  // Conta zeros
  const zeros = { cpc: 0, ctr: 0, viewability: 0, faturamento_bruto: 0, impressoes_gam: 0 };
  for (const r of adsDB || []) {
    if (!Number(r.cpc)) zeros.cpc++;
    if (!Number(r.ctr)) zeros.ctr++;
    if (!Number(r.viewability)) zeros.viewability++;
    if (!Number(r.faturamento_bruto)) zeros.faturamento_bruto++;
    if (!Number(r.impressoes_gam)) zeros.impressoes_gam++;
  }
  const total = adsDB?.length || 1;
  console.log(`\nCampos zerados (de ${total} rows):`);
  for (const [k, v] of Object.entries(zeros)) console.log(`  ${k}: ${v}/${total} zerados`);

  // ──────────────────────────────────────────────────────────
  sep('1.2 — sync_log últimos 20');
  // ──────────────────────────────────────────────────────────
  const { data: logs } = await supabase.from('sync_log').select('*').order('created_at', { ascending: false }).limit(20);
  for (const l of logs || []) {
    const ts = new Date(l.created_at).toLocaleString('pt-BR');
    console.log(`[${ts}] ${l.status} | rows=${l.rows_processed} | ${l.duration_ms}ms | ${l.message}`);
  }

  // ──────────────────────────────────────────────────────────
  sep('1.3 — Meta API insights hoje (ad level)');
  // ──────────────────────────────────────────────────────────
  const TOKEN = process.env.META_ACCESS_TOKEN_BM1;
  const ACCOUNT = process.env.META_AD_ACCOUNT_BM1;
  console.log(`Consultando Meta para: ${apiDate} (ontem)`);
  const metaRes = await axios.get(`https://graph.facebook.com/v19.0/${ACCOUNT}/insights`, {
    params: {
      access_token: TOKEN,
      time_range: JSON.stringify({ since: apiDate, until: apiDate }),
      level: 'ad',
      fields: 'ad_id,ad_name,campaign_name,adset_name,spend,clicks,impressions,ctr,cpc,actions,date_start',
      time_increment: 1,
      limit: 500,
    }
  }).catch(e => ({ data: { error: e.response?.data || e.message } }));

  const metaAds = metaRes.data?.data || [];
  console.log(`Total ads retornados: ${metaAds.length}`);
  if (metaRes.data?.error) console.error('ERRO Meta:', JSON.stringify(metaRes.data.error));

  // 3 exemplos completos
  console.log('\n--- 3 primeiros ads (COMPLETO) ---');
  for (const ad of metaAds.slice(0, 3)) {
    console.log(JSON.stringify(ad, null, 2));
  }

  // ──────────────────────────────────────────────────────────
  sep('1.4 — UTMs extraídas do Meta (extractAdUTM)');
  // ──────────────────────────────────────────────────────────
  const metaUtmSet = new Set();
  const utmExamples = {};
  for (const ad of metaAds) {
    const utm = extractAdUTM(ad.ad_name);
    if (utm) {
      metaUtmSet.add(utm);
      if (!utmExamples[utm]) utmExamples[utm] = ad.ad_name;
    } else {
      console.log(`  NENHUMA UTM extraída de ad_name="${ad.ad_name}" — vai ser IGNORADO no sync`);
    }
  }
  console.log(`\nMeta retornou ${metaAds.length} ads → ${metaUtmSet.size} UTMs únicas:`);
  for (const [utm, raw] of Object.entries(utmExamples)) {
    const spend = metaAds.filter(a => extractAdUTM(a.ad_name) === utm).reduce((s, a) => s + Number(a.spend || 0), 0);
    console.log(`  "${utm}" (ex raw: "${raw}") — spend total hoje: R$ ${spend.toFixed(2)}`);
  }

  // ──────────────────────────────────────────────────────────
  sep('1.5 — GAM CUSTOM_CRITERIA hoje (CSV bruto)');
  // ──────────────────────────────────────────────────────────
  let gamUtmSet = new Set();
  let gamRows = [];
  try {
    const gToken = await gamToken();
    console.log('Auth GAM OK');

    const xml = wrap(NETWORK_CODE, `
      <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
        <reportJob><reportQuery>
          <dimensions>DATE</dimensions>
          <dimensions>AD_UNIT_NAME</dimensions>
          <dimensions>CUSTOM_CRITERIA</dimensions>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
          <startDate>${dateXML(apiDate)}</startDate>
          <endDate>${dateXML(apiDate)}</endDate>
          <dateRangeType>CUSTOM_DATE</dateRangeType>
        </reportQuery></reportJob>
      </runReportJob>`);

    const runResp = await soap(gToken, xml);
    const jobId = tag(runResp, 'id');
    console.log('Job ID:', jobId);

    let status = 'IN_PROGRESS';
    for (let i = 0; i < 20 && status !== 'COMPLETED'; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const sr = await soap(gToken, wrap(NETWORK_CODE,
        `<getReportJobStatus xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId}</reportJobId></getReportJobStatus>`));
      status = tag(sr, 'rval') || 'FAILED';
      process.stdout.write(`  poll ${i + 1}: ${status}\n`);
      if (status === 'FAILED') throw new Error('GAM job falhou');
    }

    const urlResp = await soap(gToken, wrap(NETWORK_CODE,
      `<getReportDownloadURL xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId}</reportJobId><exportFormat>CSV_DUMP</exportFormat></getReportDownloadURL>`));
    const rawUrl = tag(urlResp, 'rval');
    const url = rawUrl.replace(/&amp;/g, '&');

    const csvResp = await axios.get(url, { timeout: 60000, responseType: 'arraybuffer' });
    const buf = Buffer.from(csvResp.data);
    const csvText = (buf[0] === 0x1f && buf[1] === 0x8b) ? (await gunzip(buf)).toString('utf8') : buf.toString('utf8');

    const csvPath = require('path').join(__dirname, '..', 'gam-debug.csv');
    fs.writeFileSync(csvPath, csvText);
    console.log('CSV salvo em', csvPath);

    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
    gamRows = lines.slice(1).map(l => {
      const vals = l.split(',').map(v => v.replace(/^"|"$/g, '').trim());
      const row = {};
      headers.forEach((h, i) => row[h] = vals[i] ?? '');
      return row;
    });

    console.log(`\nTotal linhas CSV: ${lines.length - 1} (sem header)`);
    console.log('COLUNAS:', headers.join(' | '));
    console.log('\n5 primeiras linhas:');
    for (const l of lines.slice(1, 6)) console.log(' ', l);

    // Extrair UTMs únicas do CUSTOM_CRITERIA
    const ccKey = headers.find(h => h.includes('CUSTOM_CRITERIA'));
    const dateKey = headers.find(h => h.includes('DATE'));
    const revKey = headers.find(h => h.includes('REVENUE'));
    const impKey = headers.find(h => h.includes('IMPRESSIONS'));

    const utmRevMap = {};
    for (const row of gamRows) {
      const kv = row[ccKey] || '';
      const m = kv.match(/utm_campaign=([^;,\s]+)/i);
      const utm = m ? m[1].trim().toLowerCase() : null;
      if (!utm || utm === 'null') continue;
      gamUtmSet.add(utm);
      const revMicros = Number(row[revKey] || 0);
      const imps = Number(row[impKey] || 0);
      if (!utmRevMap[utm]) utmRevMap[utm] = { revenue: 0, impressions: 0 };
      utmRevMap[utm].revenue += revMicros;
      utmRevMap[utm].impressions += imps;
    }

    console.log(`\nUTMs únicas no GAM hoje (utm_campaign, excluindo null): ${gamUtmSet.size}`);
    for (const [utm, v] of Object.entries(utmRevMap)) {
      const revUSD = v.revenue / 1_000_000;
      console.log(`  "${utm}": ${v.impressions} impressões, $${revUSD.toFixed(4)} USD micros`);
    }
    if (gamUtmSet.size === 0) {
      console.log('  *** NENHUMA UTM encontrada no GAM para hoje ***');
      console.log('  Exemplos de CUSTOM_CRITERIA no CSV:');
      const examples = [...new Set(gamRows.map(r => r[ccKey]).filter(Boolean))].slice(0, 10);
      for (const ex of examples) console.log('   ', ex || '(vazio)');
    }

    // Também mostrar dados GAM sem filtro UTM (total)
    let totalRevMicros = 0, totalImps = 0;
    for (const row of gamRows) {
      totalRevMicros += Number(row[revKey] || 0);
      totalImps += Number(row[impKey] || 0);
    }
    console.log(`\nGAM hoje total (TODAS linhas): ${totalImps} impressões, $${(totalRevMicros/1_000_000).toFixed(4)} USD`);

    // Verificar se tem linha de TOTAL no final
    const lastLine = lines[lines.length - 1];
    console.log('Última linha do CSV:', lastLine);

    // Verificar conteúdo do campo CUSTOM_CRITERIA raw
    const ccSample = gamRows.slice(0, 20).map(r => r[ccKey]).filter(Boolean);
    console.log('\nAmostra do campo CUSTOM_CRITERIA (20 primeiras linhas não-vazias):');
    const uniqCC = [...new Set(ccSample)].slice(0, 10);
    for (const cc of uniqCC) console.log('  |' + cc + '|');

  } catch (e) {
    console.error('ERRO GAM:', e.message);
    if (e.response?.data) console.error('Response:', String(e.response.data).slice(0, 500));
  }

  // ──────────────────────────────────────────────────────────
  sep('1.6 — Comparação Meta UTMs × GAM UTMs');
  // ──────────────────────────────────────────────────────────
  console.log(`\nMeta UTMs (${metaUtmSet.size}):`, [...metaUtmSet].join(', '));
  console.log(`GAM  UTMs (${gamUtmSet.size}):`, [...gamUtmSet].join(', '));

  const metaNoGam = [...metaUtmSet].filter(u => !gamUtmSet.has(u));
  const gamNoMeta = [...gamUtmSet].filter(u => !metaUtmSet.has(u));
  const matched = [...metaUtmSet].filter(u => gamUtmSet.has(u));

  console.log(`\nMatched (${matched.length}/${metaUtmSet.size}): ${matched.join(', ') || 'NENHUM'}`);
  console.log(`Meta SEM match no GAM: ${metaNoGam.join(', ') || 'nenhum'}`);
  console.log(`GAM SEM match no Meta: ${gamNoMeta.join(', ') || 'nenhum'}`);

  const matchPct = metaUtmSet.size > 0 ? ((matched.length / metaUtmSet.size) * 100).toFixed(0) : 0;
  console.log(`Taxa de match Meta→GAM: ${matchPct}%`);

  // ──────────────────────────────────────────────────────────
  sep('RESUMO DIAGNÓSTICO');
  // ──────────────────────────────────────────────────────────
  const total2 = adsDB?.length || 1;
  console.log('\nAds no banco (últimos 3 dias):', total2);
  console.log('Meta ads hoje:', metaAds.length);
  console.log('Meta UTMs únicas:', metaUtmSet.size);
  console.log('GAM UTMs hoje:', gamUtmSet.size);
  console.log('Match Meta→GAM:', matchPct + '%');
  console.log('\nCampos zerados (de', total2, 'rows):');
  for (const [k, v] of Object.entries(zeros)) {
    const pct = ((v / total2) * 100).toFixed(0);
    const status = v === 0 ? '✓ OK' : v === total2 ? '✗ TODOS ZERADOS' : `⚠ ${pct}% zerados`;
    console.log(`  ${k.padEnd(20)} ${v}/${total2}  ${status}`);
  }

})().catch(e => { console.error('\nFATAL:', e.message, e.stack); process.exit(1); });
