'use strict';
require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

const GAM_VERSION = 'v202605';
const SOAP_ENDPOINT = `https://ads.google.com/apis/ads/publisher/${GAM_VERSION}/ReportService`;
const NETWORK_CODE = process.env.GOOGLE_ADM_NETWORK_CODE;
const KEY_FILE = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON || './credentials/google-service-account.json';

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

(async () => {
  const until = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  console.log(`\nGAM CSV TEST — range: ${since} → ${until}\nNetwork: ${NETWORK_CODE}\n`);

  const token = await getToken();
  console.log('Auth OK, token prefix:', token.slice(0, 20) + '...\n');

  // ── RELATÓRIO 1: blocos_anuncio (DATE + AD_UNIT_NAME) ──
  console.log('═══ RELATÓRIO 1: DATE + AD_UNIT_NAME (usado pelo sync) ═══');
  const xml1 = wrap(`
    <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJob><reportQuery>
        <dimensions>DATE</dimensions>
        <dimensions>AD_UNIT_NAME</dimensions>
        <columns>AD_SERVER_IMPRESSIONS</columns>
        <columns>AD_SERVER_CLICKS</columns>
        <columns>AD_SERVER_CPM_AND_CPC_REVENUE</columns>
        <columns>AD_SERVER_WITHOUT_CPD_AVERAGE_ECPM</columns>
        <columns>TOTAL_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS</columns>
        <columns>TOTAL_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CPC</columns>
        <startDate>${dateXML(since)}</startDate>
        <endDate>${dateXML(until)}</endDate>
        <dateRangeType>CUSTOM_DATE</dateRangeType>
      </reportQuery></reportJob>
    </runReportJob>`);

  const r1 = await soap(token, xml1);
  const jobId1 = tag(r1, 'id');
  console.log('Job ID:', jobId1);

  // Poll
  let status1 = 'IN_PROGRESS';
  for (let i = 0; i < 20 && status1 !== 'COMPLETED'; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const sr = await soap(token, wrap(`<getReportJobStatus xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId1}</reportJobId></getReportJobStatus>`));
    status1 = tag(sr, 'rval') || 'FAILED';
    process.stdout.write(`  poll ${i + 1}: ${status1}\n`);
    if (status1 === 'FAILED') throw new Error('job failed');
  }

  const urlResp1 = await soap(token, wrap(`<getReportDownloadURL xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId1}</reportJobId><exportFormat>CSV_DUMP</exportFormat></getReportDownloadURL>`));
  const url1 = tag(urlResp1, 'rval');
  console.log('Download URL OK');

  // GAM download URLs are pre-signed — do NOT send Authorization header (causes 403)
  // XML-unescape the signed URL (SOAP returns &amp; instead of &)
  const url1clean = url1.replace(/&amp;/g, '&');
  console.log('Download URL (unescaped):', url1clean.slice(0, 120) + '...');
  const csvResp1 = await axios.get(url1clean, { timeout: 60000, responseType: 'arraybuffer' });
  const buf1 = Buffer.from(csvResp1.data);
  const csv1 = (buf1[0] === 0x1f && buf1[1] === 0x8b) ? (await gunzip(buf1)).toString('utf8') : buf1.toString('utf8');

  const lines1 = csv1.trim().split('\n');
  console.log(`\nTotal linhas CSV: ${lines1.length} (incluindo header)`);
  console.log('\nHEADER:', lines1[0]);
  console.log('\nPrimeiras 20 linhas de dados:');
  lines1.slice(1, 21).forEach((l, i) => console.log(`  ${i + 1}: ${l}`));

  // Quick aggregate
  const headers1 = lines1[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  console.log('\nColunas disponíveis:', headers1.join(' | '));

  // ── RELATÓRIO 2: UTM (AD_UNIT_NAME + CUSTOM_CRITERIA) ──
  console.log('\n\n═══ RELATÓRIO 2: AD_UNIT_NAME + CUSTOM_CRITERIA (UTM funnels) ═══');
  const xml2 = wrap(`
    <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJob><reportQuery>
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

  const r2 = await soap(token, xml2);
  const jobId2 = tag(r2, 'id');
  console.log('Job ID:', jobId2);

  let status2 = 'IN_PROGRESS';
  for (let i = 0; i < 20 && status2 !== 'COMPLETED'; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const sr = await soap(token, wrap(`<getReportJobStatus xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId2}</reportJobId></getReportJobStatus>`));
    status2 = tag(sr, 'rval') || 'FAILED';
    process.stdout.write(`  poll ${i + 1}: ${status2}\n`);
    if (status2 === 'FAILED') throw new Error('job2 failed');
  }

  const urlResp2 = await soap(token, wrap(`<getReportDownloadURL xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"><reportJobId>${jobId2}</reportJobId><exportFormat>CSV_DUMP</exportFormat></getReportDownloadURL>`));
  const url2 = tag(urlResp2, 'rval');
  const url2clean = url2.replace(/&amp;/g, '&');
  const csvResp2 = await axios.get(url2clean, { timeout: 60000, responseType: 'arraybuffer' });
  const buf2 = Buffer.from(csvResp2.data);
  const csv2 = (buf2[0] === 0x1f && buf2[1] === 0x8b) ? (await gunzip(buf2)).toString('utf8') : buf2.toString('utf8');

  const lines2 = csv2.trim().split('\n');
  console.log(`\nTotal linhas CSV: ${lines2.length}`);
  console.log('HEADER:', lines2[0]);
  console.log('\nPrimeiras 30 linhas de dados (filtrando utm_campaign):');
  const utmLines = lines2.slice(1).filter(l => l.toLowerCase().includes('utm_campaign'));
  console.log(`Linhas com utm_campaign: ${utmLines.length}`);
  utmLines.slice(0, 20).forEach((l, i) => console.log(`  ${i + 1}: ${l}`));
  if (!utmLines.length) {
    console.log('(nenhuma linha com utm_campaign — mostrando primeiras 20 linhas)');
    lines2.slice(1, 21).forEach((l, i) => console.log(`  ${i + 1}: ${l}`));
  }
  console.log('\nColunas disponíveis:', lines2[0].split(',').map(h => h.replace(/^"|"$/g, '').trim()).join(' | '));
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
