'use strict';
require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const axios = require('axios');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

const GAM_VERSION = 'v202505';
const SOAP_ENDPOINT = `https://ads.google.com/apis/ads/publisher/${GAM_VERSION}/ReportService`;
const NETWORK_CODE = process.env.GOOGLE_ADM_NETWORK_CODE;
const KEY_FILE = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON || './credentials/google-service-account.json';

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

async function getToken() {
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/admanager'] });
  const client = await auth.getClient();
  return (await client.getAccessToken()).token;
}

function header() {
  return `<soapenv:Header>
    <ns1:RequestHeader xmlns:ns1="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"
      soapenv:actor="http://schemas.xmlsoap.org/soap/actor/next" soapenv:mustUnderstand="0">
      <ns1:networkCode>${NETWORK_CODE}</ns1:networkCode>
      <ns1:applicationName>media-intelligence</ns1:applicationName>
    </ns1:RequestHeader></soapenv:Header>`;
}

function wrap(body) {
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  ${header()}<soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
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

async function runAndDownload(token, xml, label) {
  console.log(`\n[${label}] Enviando job...`);
  const r = await soap(token, xml);
  const jobId = tag(r, 'id');
  if (!jobId) throw new Error(`[${label}] Falhou ao criar job. Resposta: ${r.slice(0, 400)}`);
  console.log(`[${label}] Job ID: ${jobId}`);

  let status = 'IN_PROGRESS';
  for (let i = 0; i < 24 && status !== 'COMPLETED'; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const sr = await soap(token, wrap(`<getReportJobStatus xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId}</reportJobId></getReportJobStatus>`));
    status = tag(sr, 'rval') || 'FAILED';
    process.stdout.write(`  poll ${i + 1}: ${status}\n`);
    if (status === 'FAILED') throw new Error(`[${label}] Job falhou`);
  }
  if (status !== 'COMPLETED') throw new Error(`[${label}] Timeout`);

  const urlResp = await soap(token, wrap(`<getReportDownloadURL xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId}</reportJobId><exportFormat>CSV_DUMP</exportFormat></getReportDownloadURL>`));
  const rawUrl = tag(urlResp, 'rval');
  if (!rawUrl) throw new Error(`[${label}] Sem URL de download`);
  const cleanUrl = rawUrl.replace(/&amp;/g, '&');

  const csvResp = await axios.get(cleanUrl, { timeout: 60000, responseType: 'arraybuffer' });
  const buf = Buffer.from(csvResp.data);
  const csv = (buf[0] === 0x1f && buf[1] === 0x8b) ? (await gunzip(buf)).toString('utf8') : buf.toString('utf8');
  return csv;
}

async function main() {
  if (!NETWORK_CODE) { console.error('GOOGLE_ADM_NETWORK_CODE não configurado'); process.exit(1); }

  const since = daysAgo(7);
  const until = today();
  console.log(`\n═══ diag-gam.js — ${since} → ${until} | Network: ${NETWORK_CODE} ═══`);

  const token = await getToken();
  console.log('Auth OK');

  // ── Relatório CUSTOM_CRITERIA (UTM funnels) ──
  const xml = wrap(`
    <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJob><reportQuery>
        <dimensions>DATE</dimensions>
        <dimensions>AD_UNIT_NAME</dimensions>
        <dimensions>CUSTOM_CRITERIA</dimensions>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
        <startDate>${dateXML(since)}</startDate>
        <endDate>${dateXML(until)}</endDate>
        <dateRangeType>CUSTOM_DATE</dateRangeType>
      </reportQuery></reportJob>
    </runReportJob>`);

  const csv = await runAndDownload(token, xml, 'CUSTOM_CRITERIA');

  // Save CSV
  const csvPath = path.join(__dirname, '..', 'gam-diag-utm.csv');
  fs.writeFileSync(csvPath, csv, 'utf8');
  console.log(`\nCSV salvo em: ${csvPath}`);

  const lines = csv.trim().split('\n').filter(Boolean);
  console.log(`Total linhas (incluindo header): ${lines.length}`);
  console.log(`Header: ${lines[0]}`);

  // Parse
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  console.log('\nColunas disponíveis:', headers.join(' | '));

  const rows = lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });

  // Extract utm_campaign from CUSTOM_CRITERIA
  const utmCampMap = {};
  const nonUtm = [];
  for (const row of rows) {
    const kv = row['Dimension.CUSTOM_CRITERIA'] || row['CUSTOM_CRITERIA'] || '';
    const m = kv.match(/utm_campaign=([^;,\s]+)/i);
    const utmCamp = m ? m[1].toLowerCase() : null;
    const revMicros = +(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
    const impressions = +(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
    const revenue = revMicros / 1_000_000;
    if (utmCamp && utmCamp !== 'null') {
      if (!utmCampMap[utmCamp]) utmCampMap[utmCamp] = { utm_campaign: utmCamp, revenue: 0, impressions: 0, rows: 0 };
      utmCampMap[utmCamp].revenue += revenue;
      utmCampMap[utmCamp].impressions += impressions;
      utmCampMap[utmCamp].rows++;
    } else {
      nonUtm.push(kv.slice(0, 80));
    }
  }

  const utmList = Object.values(utmCampMap).map(u => ({
    utm_campaign: u.utm_campaign,
    revenue_usd: +u.revenue.toFixed(4),
    impressions: u.impressions,
    rows: u.rows,
  })).sort((a, b) => a.utm_campaign.localeCompare(b.utm_campaign));

  console.log(`\nTotal linhas com utm_campaign: ${Object.values(utmCampMap).reduce((s, u) => s + u.rows, 0)}`);
  console.log(`Total UTMs únicas: ${utmList.length}`);
  console.log('\nLista de utm_campaign únicos:');
  console.table(utmList);

  const hasYobanna = utmList.some(u => u.utm_campaign.includes('yobanna'));
  console.log(`\n"yobannafb" aparece no GAM: ${hasYobanna ? '✅ SIM' : '❌ NÃO'}`);

  console.log(`\nLinhas SEM utm_campaign: ${nonUtm.length}`);
  if (nonUtm.length) {
    const sample = [...new Set(nonUtm)].slice(0, 10);
    console.log('Amostras de CUSTOM_CRITERIA sem utm_campaign:');
    sample.forEach(s => console.log(`  "${s}"`));
  }

  // Primeiras 20 linhas
  console.log('\nPrimeiras 20 linhas dos dados:');
  rows.slice(0, 20).forEach((r, i) => {
    const date = r['Dimension.DATE'] || r['DATE'] || '';
    const adUnit = r['Dimension.AD_UNIT_NAME'] || r['AD_UNIT_NAME'] || '';
    const cc = r['Dimension.CUSTOM_CRITERIA'] || r['CUSTOM_CRITERIA'] || '';
    const rev = r['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || r['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || '';
    const imp = r['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || r['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || '';
    console.log(`  ${i + 1}: date=${date} | adUnit=${adUnit} | cc=${cc.slice(0, 60)} | rev=${rev} | imp=${imp}`);
  });
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
