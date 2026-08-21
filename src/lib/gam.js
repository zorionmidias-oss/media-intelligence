'use strict';
const { google } = require('googleapis');
const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const supabase = require('./supabase');

const GAM_VERSION = process.env.GAM_API_VERSION || 'v202605';
const SOAP_ENDPOINT = `https://ads.google.com/apis/ads/publisher/${GAM_VERSION}/ReportService`;
const SCOPE = [
  'https://www.googleapis.com/auth/admanager',
  'https://www.googleapis.com/auth/devstorage.read_only',
];
const NETWORK_CODE = process.env.GOOGLE_ADM_NETWORK_CODE;
const SA_JSON_CONTENT = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON_CONTENT;
const KEY_FILE = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON || './credentials/google-service-account.json';

let _cachedToken = null;
let _tokenExpiry  = 0;

const { getUSDtoBRL, getUSDtoBRLByDate } = require('../services/exchange.service');

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60000) return _cachedToken;
  let auth;
  if (SA_JSON_CONTENT) {
    auth = new google.auth.GoogleAuth({ credentials: JSON.parse(SA_JSON_CONTENT), scopes: SCOPE });
  } else {
    auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: SCOPE });
  }
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  _cachedToken = tokenResponse.token;
  _tokenExpiry = Date.now() + 3500 * 1000;
  return _cachedToken;
}

function soapHeader(networkCode) {
  return `<soapenv:Header>
    <ns1:RequestHeader xmlns:ns1="https://www.google.com/apis/ads/publisher/${GAM_VERSION}"
      soapenv:actor="http://schemas.xmlsoap.org/soap/actor/next"
      soapenv:mustUnderstand="0">
      <ns1:networkCode>${networkCode}</ns1:networkCode>
      <ns1:applicationName>media-intelligence</ns1:applicationName>
    </ns1:RequestHeader>
  </soapenv:Header>`;
}

function wrapEnvelope(header, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  ${header}
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;
}

function dateToXML(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `<year>${y}</year><month>${parseInt(m)}</month><day>${parseInt(d)}</day>`;
}

function buildRunReportJobXML(networkCode, since, until) {
  return wrapEnvelope(soapHeader(networkCode), `
    <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJob>
        <reportQuery>
          <dimensions>DATE</dimensions>
          <dimensions>AD_UNIT_NAME</dimensions>
          <columns>AD_SERVER_IMPRESSIONS</columns>
          <columns>AD_SERVER_CLICKS</columns>
          <columns>AD_SERVER_CTR</columns>
          <columns>AD_SERVER_CPM_AND_CPC_REVENUE</columns>
          <columns>AD_SERVER_WITHOUT_CPD_AVERAGE_ECPM</columns>
          <columns>TOTAL_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS</columns>
          <columns>TOTAL_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC</columns>
          <startDate>${dateToXML(since)}</startDate>
          <endDate>${dateToXML(until)}</endDate>
          <dateRangeType>CUSTOM_DATE</dateRangeType>
        </reportQuery>
      </reportJob>
    </runReportJob>`);
}

function buildAdvertiserReportXML(networkCode, since, until) {
  return wrapEnvelope(soapHeader(networkCode), `
    <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJob>
        <reportQuery>
          <dimensions>ADVERTISER_NAME</dimensions>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
          <columns>AD_SERVER_WITHOUT_CPD_AVERAGE_ECPM</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CPC</columns>
          <columns>AD_SERVER_CTR</columns>
          <startDate>${dateToXML(since)}</startDate>
          <endDate>${dateToXML(until)}</endDate>
          <dateRangeType>CUSTOM_DATE</dateRangeType>
        </reportQuery>
      </reportJob>
    </runReportJob>`);
}

function buildGetStatusXML(networkCode, jobId) {
  return wrapEnvelope(soapHeader(networkCode), `
    <getReportJobStatus xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJobId>${jobId}</reportJobId>
    </getReportJobStatus>`);
}

function buildGetDownloadURLXML(networkCode, jobId) {
  return wrapEnvelope(soapHeader(networkCode), `
    <getReportDownloadURL xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJobId>${jobId}</reportJobId>
      <exportFormat>CSV_DUMP</exportFormat>
    </getReportDownloadURL>`);
}

function extractTag(xml, tag) {
  const re = new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[\\w]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

async function soapCall(token, xml, action) {
  const res = await axios.post(SOAP_ENDPOINT, xml, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': action || '',
      Authorization: `Bearer ${token}`,
    },
    timeout: 30000,
  });
  return res.data;
}

function parseCSV(csv) {
  const lines = csv.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

function defaultDateRange() {
  const { hojeBR, diasAtrasBR } = require('./datas');
  return { since: diasAtrasBR(30), until: hojeBR() };
}

async function pollAndDownload(token, networkCode, jobId) {
  let status = 'IN_PROGRESS';
  for (let attempt = 0; attempt < 20 && status !== 'COMPLETED'; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusResp = await soapCall(token, buildGetStatusXML(networkCode, jobId));
    status = extractTag(statusResp, 'rval') || 'FAILED';
    if (status === 'FAILED') throw new Error('GAM report job failed');
  }
  if (status !== 'COMPLETED') throw new Error('GAM report job timed out');

  const urlResp = await soapCall(token, buildGetDownloadURLXML(networkCode, jobId));
  const rawUrl = extractTag(urlResp, 'rval');
  if (!rawUrl) throw new Error('GAM: failed to get download URL');
  // XML-unescape ampersands in the signed URL query string
  const downloadUrl = rawUrl.replace(/&amp;/g, '&');

  const csvResp = await axios.get(downloadUrl, {
    timeout: 60000,
    responseType: 'arraybuffer',
  });
  const buf = Buffer.from(csvResp.data);
  const csvText = buf[0] === 0x1f && buf[1] === 0x8b
    ? (await gunzip(buf)).toString('utf8')
    : buf.toString('utf8');
  return parseCSV(csvText).rows;
}

async function fetchGAMReport(dateRange, networkCodeArg) {
  const networkCode = networkCodeArg || NETWORK_CODE;
  if (!networkCode) throw new Error('GOOGLE_ADM_NETWORK_CODE not configured');

  const { since, until } = dateRange || defaultDateRange();
  const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);

  const runXML = buildRunReportJobXML(networkCode, since, until);
  const runResp = await soapCall(token, runXML);
  const jobId = extractTag(runResp, 'id');
  if (!jobId) throw new Error('GAM: failed to create report job');

  const rows = await pollAndDownload(token, networkCode, jobId);

  const adUnitMap = {};
  // adUnitsByDay: { 'yyyy-mm-dd' → { adUnit → { impressions, clicks, revenue, adxImp, viewable, measurable } } }
  const adUnitsByDay = {};
  const dailyRevenue = {};
  let totalServerImpressions = 0, totalAdxImpressions = 0;
  let totalClicks = 0, totalAdxClicks = 0, totalRevenue = 0;
  let totalViewable = 0, totalMeasurable = 0;
  let totalAdxCpcWtSum = 0, totalAdxCpcWt = 0;
  let totalAdxCtrWtSum = 0, totalAdxCtrWt = 0;
  let latestDate = '';

  for (const row of rows) {
    const date = row['Dimension.DATE'] || row['DATE'] || '';
    const adUnit = row['Dimension.AD_UNIT_NAME'] || row['AD_UNIT_NAME'] || 'Unknown';
    const serverImp = Number(row['Column.AD_SERVER_IMPRESSIONS'] || row['AD_SERVER_IMPRESSIONS'] || 0);
    const clicks = Number(row['Column.AD_SERVER_CLICKS'] || row['AD_SERVER_CLICKS'] || 0);
    // AD_SERVER revenue is in USD (not micros)
    const adServerRevenue = Number(row['Column.AD_SERVER_CPM_AND_CPC_REVENUE'] || row['AD_SERVER_CPM_AND_CPC_REVENUE'] || 0) * rate;
    const viewable = Number(row['Column.TOTAL_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS'] || row['TOTAL_ACTIVE_VIEW_VIEWABLE_IMPRESSIONS'] || 0);
    const measurable = Number(row['Column.TOTAL_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS'] || row['TOTAL_ACTIVE_VIEW_MEASURABLE_IMPRESSIONS'] || 0);
    // AD_EXCHANGE revenue is in micros
    const adxRevenueMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
    const adxImp = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
    const adxRevenue = (adxRevenueMicros / 1_000_000) * rate;
    const adxClicks = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || 0);
    const adxCtrRaw = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || 0);
    const adxAvgCpcMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || 0);
    if (adxClicks > 0) {
      totalAdxCtrWtSum += adxCtrRaw * adxClicks;
      totalAdxCtrWt += adxClicks;
      if (adxAvgCpcMicros > 0) {
        totalAdxCpcWtSum += adxAvgCpcMicros * adxClicks;
        totalAdxCpcWt += adxClicks;
      }
    }
    const revenue = adServerRevenue + adxRevenue;
    const allImpressions = serverImp + adxImp;

    totalServerImpressions += serverImp;
    totalAdxImpressions += adxImp;
    totalClicks += clicks;
    totalAdxClicks += adxClicks;
    totalRevenue += revenue;
    totalViewable += viewable;
    totalMeasurable += measurable;
    if (date > latestDate) latestDate = date;

    if (!adUnitMap[adUnit]) {
      adUnitMap[adUnit] = { name: adUnit, impressions: 0, serverImpressions: 0, adxImpressions: 0, clicks: 0, adxClicks: 0, revenue: 0, viewable: 0, measurable: 0, adxCpcWtSum: 0, adxCpcWt: 0 };
    }
    const u = adUnitMap[adUnit];
    u.impressions += allImpressions;
    u.serverImpressions += serverImp;
    u.adxImpressions += adxImp;
    u.clicks += clicks;
    u.adxClicks += adxClicks;
    u.revenue += revenue;
    u.viewable += viewable;
    u.measurable += measurable;
    if (adxClicks > 0 && adxAvgCpcMicros > 0) {
      u.adxCpcWtSum += adxAvgCpcMicros * adxClicks;
      u.adxCpcWt += adxClicks;
    }

    if (date) {
      dailyRevenue[date] = (dailyRevenue[date] || 0) + revenue;
      if (!adUnitsByDay[date]) adUnitsByDay[date] = {};
      if (!adUnitsByDay[date][adUnit]) adUnitsByDay[date][adUnit] = { impressions: 0, serverImpressions: 0, adxImpressions: 0, clicks: 0, revenue: 0, viewable: 0, measurable: 0 };
      const du = adUnitsByDay[date][adUnit];
      du.impressions += allImpressions;
      du.serverImpressions += serverImp;
      du.adxImpressions += adxImp;
      du.clicks += clicks;
      du.revenue += revenue;
      du.viewable += viewable;
      du.measurable += measurable;
    }
  }

  const totalImpressions = totalServerImpressions + totalAdxImpressions;
  const ecpm = totalImpressions > 0 ? (totalRevenue / totalImpressions) * 1000 : 0;
  // CTR: use AdX weighted CTR if available, fall back to clicks/impressions
  const ctr = totalAdxCtrWt > 0
    ? (totalAdxCtrWtSum / totalAdxCtrWt) * 100
    : (totalImpressions > 0 ? (totalAdxClicks / totalImpressions) * 100 : 0);
  // CPC: use weighted average AdX CPC (micros → BRL) if available
  const cpc = totalAdxCpcWt > 0
    ? (totalAdxCpcWtSum / totalAdxCpcWt / 1_000_000) * rate
    : (totalAdxClicks > 0 ? totalRevenue / totalAdxClicks : 0);
  const viewability = totalMeasurable > 0 ? (totalViewable / totalMeasurable) * 100 : 0;
  // taxaProgramatica uses totalImpressions (server + adx) as denominator
  const taxaProgramatica = totalImpressions > 0 ? (totalAdxImpressions / totalImpressions) * 100 : 0;
  // RPS = (adxImpressions / totalImpressions × eCPM) / 100
  const rps = totalImpressions > 0 ? (totalAdxImpressions / totalImpressions * ecpm) / 100 : 0;
  const cpaIdeal = rps / 1000;
  const delayHours = latestDate
    ? Math.round((Date.now() - new Date(latestDate).getTime()) / 3600000)
    : 0;

  const adUnits = Object.values(adUnitMap)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10)
    .map(u => ({
      ...u,
      ecpm: u.impressions > 0 ? (u.revenue / u.impressions) * 1000 : 0,
      ctr: u.impressions > 0 ? (u.adxClicks / u.impressions) * 100 : 0,
      // CPC: use GAM column if available; fall back to revenue/clicks (CPM inventory)
      cpc_gam: u.adxCpcWt > 0
        ? (u.adxCpcWtSum / u.adxCpcWt / 1_000_000) * rate
        : (u.adxClicks > 0 ? u.revenue / u.adxClicks : 0),
      cliques_gam: u.adxClicks,
      viewability: u.measurable > 0 ? (u.viewable / u.measurable) * 100 : 0,
      taxaProgramatica: u.serverImpressions > 0 ? (u.adxImpressions / u.serverImpressions) * 100 : 0,
    }));

  return {
    summary: {
      impressions: totalImpressions,
      serverImpressions: totalServerImpressions,
      adxImpressions: totalAdxImpressions,
      clicks: totalClicks,
      revenue: totalRevenue,
      ecpm, ctr, cpc, viewability,
      taxaProgramatica, rps, cpaIdeal,
    },
    adUnits,
    adUnitsByDay,
    topAdvertisers: [],
    dailyRevenue,
    delayHours,
    usdToBrl: rate,
  };
}

async function fetchGAMAdvertisers(dateRange) {
  const networkCode = NETWORK_CODE;
  if (!networkCode) return [];
  const { since, until } = dateRange || defaultDateRange();

  try {
    const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);
    const xml = buildAdvertiserReportXML(networkCode, since, until);
    const runResp = await soapCall(token, xml);
    const jobId = extractTag(runResp, 'id');
    if (!jobId) return [];

    const rows = await pollAndDownload(token, networkCode, jobId);

    return rows
      .map(row => {
        const name = row['Dimension.ADVERTISER_NAME'] || row['ADVERTISER_NAME'] || 'Unknown';
        const revMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
        const revenue = (revMicros / 1_000_000) * rate;
        const impressions = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
        // AD_SERVER_WITHOUT_CPD_AVERAGE_ECPM is an Ad Server metric → in USD (not micros)
        const ecpm = Number(row['Column.AD_SERVER_WITHOUT_CPD_AVERAGE_ECPM'] || row['AD_SERVER_WITHOUT_CPD_AVERAGE_ECPM'] || 0) * rate;
        // AD_EXCHANGE CPC is in micros
        const cpcMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CPC'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CPC'] || 0);
        const cpc = (cpcMicros / 1_000_000) * rate;
        // CTR as decimal (0.02 = 2%)
        const ctr = Number(row['Column.AD_SERVER_CTR'] || row['AD_SERVER_CTR'] || 0) * 100;
        return { name, revenue, impressions, ecpm, cpc, ctr };
      })
      .filter(a => a.impressions > 0 || a.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);
  } catch (e) {
    console.warn('[GAM advertisers]', e.message);
    return [];
  }
}

async function discoverGAMNetworks() {
  try {
    const token = await getAccessToken();
    const res = await axios.get('https://admanager.googleapis.com/v1/networks', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    return (res.data.networks || []).map(n => ({
      networkCode: n.networkCode || String(n.name || '').split('/').pop(),
      displayName: n.displayName || '',
      domain: _domainFromName(n.displayName || n.networkCode || ''),
    }));
  } catch (e) {
    console.warn('[GAM discoverNetworks]', e.message);
    if (NETWORK_CODE) {
      return [{ networkCode: NETWORK_CODE, displayName: 'Rede configurada', domain: NETWORK_CODE }];
    }
    return [];
  }
}

function _domainFromName(name) {
  const m = String(name).match(/^([A-Z0-9_-]+)/i);
  return m ? m[1].toUpperCase() : String(name).toUpperCase();
}

// Returns { campaigns: [...], sources: [...] } with revenue per utm_campaign and utm_source
async function fetchGAMFunnelsByUTM(networkCode, dateRange) {
  const nc = networkCode || NETWORK_CODE;
  if (!nc) return { campaigns: [], sources: [] };
  const { since, until } = dateRange || defaultDateRange();

  try {
    const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);

    const xml = wrapEnvelope(soapHeader(nc), `
      <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
        <reportJob>
          <reportQuery>
            <dimensions>DATE</dimensions>
            <dimensions>AD_UNIT_NAME</dimensions>
            <dimensions>CUSTOM_CRITERIA</dimensions>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC</columns>
            <startDate>${dateToXML(since)}</startDate>
            <endDate>${dateToXML(until)}</endDate>
            <dateRangeType>CUSTOM_DATE</dateRangeType>
          </reportQuery>
        </reportJob>
      </runReportJob>`);

    const runResp = await soapCall(token, xml);
    const jobId = extractTag(runResp, 'id');
    if (!jobId) return { campaigns: [], sources: [] };

    const rows = await pollAndDownload(token, nc, jobId);

    // dayUtmMap: { 'yyyy-mm-dd|utm' → { date, utmCampaign, revenue, impressions, ecpm, _n } }
    // campaignMap: { utm → totals across all days } (for backwards compat)
    const dayUtmMap = {};
    const campaignMap = {};
    const sourceMap = {};

    for (const row of rows) {
      const date = row['Dimension.DATE'] || row['DATE'] || '';
      const kv = row['Dimension.CUSTOM_CRITERIA'] || row['CUSTOM_CRITERIA'] || '';
      const revMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
      const revenue = (revMicros / 1_000_000) * rate;
      const impressions = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
      const ecpmMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || 0);
      const ecpm = (ecpmMicros / 1_000_000) * rate;
      const adxClicks = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || 0);
      const ctrRaw = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || 0);
      const avgCpcMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || 0);

      const utm = _extractUTMValue(kv, 'utm_campaign');
      // Skip null/empty utm values
      if (utm && utm.toLowerCase() !== 'null') {
        const dayKey = `${date}|${utm}`;
        if (!dayUtmMap[dayKey]) dayUtmMap[dayKey] = { date, utmCampaign: utm, revenue: 0, impressions: 0, ecpm: 0, cliques: 0, ctrSum: 0, cpcWtSum: 0, cpcWt: 0, _n: 0 };
        dayUtmMap[dayKey].revenue += revenue;
        dayUtmMap[dayKey].impressions += impressions;
        dayUtmMap[dayKey].ecpm += ecpm;
        dayUtmMap[dayKey].cliques += adxClicks;
        dayUtmMap[dayKey].ctrSum += ctrRaw;
        if (adxClicks > 0 && avgCpcMicros > 0) {
          dayUtmMap[dayKey].cpcWtSum += avgCpcMicros * adxClicks;
          dayUtmMap[dayKey].cpcWt += adxClicks;
        }
        dayUtmMap[dayKey]._n++;

        if (!campaignMap[utm]) campaignMap[utm] = { utmCampaign: utm, revenue: 0, impressions: 0, ecpm: 0, ctr: 0, _n: 0 };
        campaignMap[utm].revenue += revenue;
        campaignMap[utm].impressions += impressions;
        campaignMap[utm].ecpm += ecpm;
        campaignMap[utm].ctr += ctrRaw;
        campaignMap[utm]._n++;
      }

      const src = _extractUTMValue(kv, 'utm_source');
      if (src && src.toLowerCase() !== 'null') {
        if (!sourceMap[src]) sourceMap[src] = { utmSource: src, revenue: 0, impressions: 0, ecpm: 0, ctr: 0, _n: 0 };
        sourceMap[src].revenue += revenue;
        sourceMap[src].impressions += impressions;
        sourceMap[src].ecpm += ecpm;
        sourceMap[src].ctr += ctrRaw;
        sourceMap[src]._n++;
      }
    }

    // byDay: { 'yyyy-mm-dd' → { utm → { revenue, impressions, ecpm, cpc_gam, ctr_gam, cliques_gam } } }
    const byDay = {};
    for (const v of Object.values(dayUtmMap)) {
      if (!byDay[v.date]) byDay[v.date] = {};
      byDay[v.date][v.utmCampaign.toLowerCase()] = {
        revenue: v.revenue,
        impressions: v.impressions,
        ecpm: v._n > 0 ? v.ecpm / v._n : 0,
        ctr_gam: v._n > 0 ? (v.ctrSum / v._n) * 100 : 0,
        // CPC: use GAM column if available; fall back to revenue/clicks (CPM inventory)
        cpc_gam: v.cpcWt > 0
          ? (v.cpcWtSum / v.cpcWt / 1_000_000) * rate
          : (v.cliques > 0 ? v.revenue / v.cliques : 0),
        cliques_gam: v.cliques,
      };
    }

    const campaigns = Object.values(campaignMap).map(u => ({
      utmCampaign: u.utmCampaign,
      revenue: u.revenue,
      impressions: u.impressions,
      ecpm: u._n > 0 ? u.ecpm / u._n : 0,
      ctr: u._n > 0 ? u.ctr / u._n : 0,
    }));

    const sources = Object.values(sourceMap).map(u => ({
      utmSource: u.utmSource,
      revenue: u.revenue,
      impressions: u.impressions,
      ecpm: u._n > 0 ? u.ecpm / u._n : 0,
      ctr: u._n > 0 ? u.ctr / u._n : 0,
    }));

    return { campaigns, sources, byDay };
  } catch (e) {
    console.warn('[GAM fetchFunnelsByUTM]', e.message);
    return { campaigns: [], sources: [] };
  }
}

function _extractUTMValue(kv, key) {
  if (!kv) return null;
  const m = kv.match(new RegExp(`${key}=([^;,\\s]+)`, 'i'));
  return m ? m[1] : null;
}

// ─── fetchGAMHourly ──────────────────────────────────────────────────────────
// adUnitPrefix: prefixo resolvido do DB (ex: 'mku_'). Substitui a heurística de domínio.
async function fetchGAMHourly({ since, until, domain, adUnitPrefix } = {}) {
  const networkCode = NETWORK_CODE;
  if (!networkCode) return [];
  const dates = { since: since || defaultDateRange().since, until: until || defaultDateRange().until };

  try {
    const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);

    const xml = wrapEnvelope(soapHeader(networkCode), `
      <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
        <reportJob>
          <reportQuery>
            <dimensions>AD_UNIT_NAME</dimensions>
            <dimensions>HOUR</dimensions>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_UNFILLED_IMPRESSIONS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC</columns>
            <startDate>${dateToXML(dates.since)}</startDate>
            <endDate>${dateToXML(dates.until)}</endDate>
            <dateRangeType>CUSTOM_DATE</dateRangeType>
          </reportQuery>
        </reportJob>
      </runReportJob>`);

    const runResp = await soapCall(token, xml);
    const jobId = extractTag(runResp, 'id');
    if (!jobId) {
      console.warn('[GAM hourly] no jobId — runResp:', runResp.slice(0, 800));
      return [];
    }

    const rows = await pollAndDownload(token, networkCode, jobId);

    // BUG 3: usa prefixo do DB se disponível; fallback para heurística de 3 chars
    const prefix = adUnitPrefix != null ? adUnitPrefix : _domainPrefix(domain);
    return _aggregateHourlyRows(rows, rate, prefix);
  } catch (e) {
    console.warn('[GAM fetchHourly]', e.message);
    return [];
  }
}

// Agrega linhas brutas do relatório horário (AD_UNIT_NAME × HOUR) em até 24 buckets.
// key: filtra ad units. exact=false (default) → prefixo (GAM-1); exact=true → nome
// EXATO do bloco filho (GAM-2). key vazio/null = todas → agregado global.
function _aggregateHourlyRows(rows, rate, key, exact) {
  const k = key ? String(key).toLowerCase() : '';
  const hourMap = {};

  for (const row of rows) {
    const adUnit = row['Dimension.AD_UNIT_NAME'] || row['AD_UNIT_NAME'] || '';
    if (k) { const au = adUnit.toLowerCase(); if (exact ? au !== k : !au.startsWith(k)) continue; }

    const horaRaw = row['Dimension.HOUR'] || row['HOUR'] || '0';
    const hora = parseInt(horaRaw, 10);

    const imp = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
    const revMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
    const receita = (revMicros / 1_000_000) * rate;
    const ecpmMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || 0);
    const ctrRaw = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || 0);
    const cliques = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || 0);
    const cpcMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || 0);

    const naoPreench = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_UNFILLED_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_UNFILLED_IMPRESSIONS'] || 0);

    if (!hourMap[hora]) hourMap[hora] = { impressoes: 0, nao_preenchidas: 0, receita: 0, cliques: 0, ecpmWtSum: 0, ecpmWt: 0, ctrWtSum: 0, ctrWt: 0, cpcWtSum: 0, cpcWt: 0 };
    const h = hourMap[hora];
    h.impressoes += imp;
    h.nao_preenchidas += naoPreench;
    h.receita += receita;
    h.cliques += cliques;
    if (imp > 0 && ecpmMicros > 0) { h.ecpmWtSum += (ecpmMicros / 1_000_000) * rate * imp; h.ecpmWt += imp; }
    if (imp > 0) { h.ctrWtSum += ctrRaw * imp; h.ctrWt += imp; }
    if (cliques > 0 && cpcMicros > 0) { h.cpcWtSum += (cpcMicros / 1_000_000) * rate * cliques; h.cpcWt += cliques; }
  }

  return Array.from({ length: 24 }, (_, hora) => {
    const h = hourMap[hora];
    if (!h || (h.impressoes === 0 && h.nao_preenchidas === 0)) return null;
    return {
      hora,
      impressoes: h.impressoes,
      nao_preenchidas: h.nao_preenchidas,
      receita: +h.receita.toFixed(2),
      ecpm: h.ecpmWt > 0 ? +(h.ecpmWtSum / h.ecpmWt).toFixed(4) : 0,
      ctr: h.ctrWt > 0 ? +(h.ctrWtSum / h.ctrWt * 100).toFixed(4) : 0,
      cliques: h.cliques,
      cpc: h.cpcWt > 0 ? +(h.cpcWtSum / h.cpcWt).toFixed(4) : 0,
    };
  }).filter(Boolean);
}

// Prefixo de ad unit de um domínio: usa prefixo_ad_unit; senão deriva de
// codigo_pedido_gam ("MKU-AdX" → "mku_"), igual ao matching de blocos_anuncio.
function _domainAdUnitPrefix(d) {
  if (d.prefixo_ad_unit) return String(d.prefixo_ad_unit).toLowerCase();
  if (d.codigo_pedido_gam) return d.codigo_pedido_gam.split('-')[0].toLowerCase() + '_';
  return null;
}

// Roda UM job horário e bucketiza por domínio + global numa única passada.
// dominios: [{ id, prefixo_ad_unit, codigo_pedido_gam }]
// Retorna { 0: [horasGlobais], <dominio_id>: [horas], ... }
// Roda o relatório horário AD_UNIT_NAME × HOUR numa rede e devolve as linhas brutas.
async function _runHourlyReport(networkCode, dates) {
  const token = await getAccessToken();
  const xml = wrapEnvelope(soapHeader(networkCode), `
    <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJob>
        <reportQuery>
          <dimensions>AD_UNIT_NAME</dimensions>
          <dimensions>HOUR</dimensions>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_UNFILLED_IMPRESSIONS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC</columns>
          <startDate>${dateToXML(dates.since)}</startDate>
          <endDate>${dateToXML(dates.until)}</endDate>
          <dateRangeType>CUSTOM_DATE</dateRangeType>
        </reportQuery>
      </reportJob>
    </runReportJob>`);
  const runResp = await soapCall(token, xml);
  const jobId = extractTag(runResp, 'id');
  if (!jobId) { console.warn('[GAM hourly/dom] sem jobId:', runResp.slice(0, 500)); return []; }
  return pollAndDownload(token, networkCode, jobId);
}

// report_hora por domínio, ciente das duas redes (aditivo):
//   GAM-1 (rede primária): global(dominio_id=0) + domínios gam_fonte=1 por PREFIXO.
//   GAM-2 (GAM2_NETWORK_CODE): domínios gam_fonte=2 por NOME EXATO do bloco filho.
// O global(0) segue só GAM-1 — o GAM-2 é per-domínio (não infla o "todos" do overview).
async function fetchGAMHourlyByDomain({ since, until, dominios } = {}) {
  if (!NETWORK_CODE) return {};
  const dates = { since: since || defaultDateRange().since, until: until || defaultDateRange().until };
  const rate = await getUSDtoBRL().catch(() => 1);
  const doms = dominios || [];
  const out = {};

  // GAM-1 (rede atual) — comportamento inalterado
  try {
    const rows1 = await _runHourlyReport(NETWORK_CODE, dates);
    out[0] = _aggregateHourlyRows(rows1, rate, '');
    for (const d of doms) {
      if ((d.gam_fonte || 1) !== 1) continue;
      const pfx = _domainAdUnitPrefix(d);
      if (pfx) out[d.id] = _aggregateHourlyRows(rows1, rate, pfx);
    }
  } catch (e) { console.warn('[GAM fetchHourlyByDomain/GAM-1]', e.message); }

  // GAM-2 (rede nova) — match por nome exato do bloco filho
  const GAM2_NC = process.env.GAM2_NETWORK_CODE;
  const gam2 = doms.filter(d => (d.gam_fonte || 1) === 2 && d.ad_unit_filho);
  if (GAM2_NC && gam2.length) {
    try {
      const rows2 = await _runHourlyReport(GAM2_NC, dates);
      for (const d of gam2) out[d.id] = _aggregateHourlyRows(rows2, rate, d.ad_unit_filho, true);
    } catch (e) { console.warn('[GAM fetchHourlyByDomain/GAM-2]', e.message); }
  }

  return out;
}

// ─── fetchGAMUtmCampaigns ────────────────────────────────────────────────────
async function fetchGAMUtmCampaigns({ since, until, domain, adUnitPrefix } = {}) {
  const networkCode = NETWORK_CODE;
  if (!networkCode) return [];
  const dates = { since: since || defaultDateRange().since, until: until || defaultDateRange().until };

  try {
    const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);

    const xml = wrapEnvelope(soapHeader(networkCode), `
      <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
        <reportJob>
          <reportQuery>
            <dimensions>CUSTOM_CRITERIA</dimensions>
            <dimensions>AD_UNIT_NAME</dimensions>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC</columns>
            <startDate>${dateToXML(dates.since)}</startDate>
            <endDate>${dateToXML(dates.until)}</endDate>
            <dateRangeType>CUSTOM_DATE</dateRangeType>
          </reportQuery>
        </reportJob>
      </runReportJob>`);

    const runResp = await soapCall(token, xml);
    const jobId = extractTag(runResp, 'id');
    if (!jobId) {
      console.warn('[GAM utmCampaigns] no jobId — runResp:', runResp.slice(0, 800));
      return [];
    }

    const rows = await pollAndDownload(token, networkCode, jobId);
    const resolvedPrefix = adUnitPrefix != null ? adUnitPrefix : _domainPrefix(domain);
    return _aggregateUtm(rows, 'utm_campaign', resolvedPrefix, rate);
  } catch (e) {
    console.warn('[GAM fetchUtmCampaigns]', e.message);
    return [];
  }
}

// ─── fetchGAMUtmSources ──────────────────────────────────────────────────────
async function fetchGAMUtmSources({ since, until, domain, adUnitPrefix } = {}) {
  const networkCode = NETWORK_CODE;
  if (!networkCode) return [];
  const dates = { since: since || defaultDateRange().since, until: until || defaultDateRange().until };

  try {
    const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);

    const xml = wrapEnvelope(soapHeader(networkCode), `
      <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
        <reportJob>
          <reportQuery>
            <dimensions>CUSTOM_CRITERIA</dimensions>
            <dimensions>AD_UNIT_NAME</dimensions>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC</columns>
            <startDate>${dateToXML(dates.since)}</startDate>
            <endDate>${dateToXML(dates.until)}</endDate>
            <dateRangeType>CUSTOM_DATE</dateRangeType>
          </reportQuery>
        </reportJob>
      </runReportJob>`);

    const runResp = await soapCall(token, xml);
    const jobId = extractTag(runResp, 'id');
    if (!jobId) {
      console.warn('[GAM utmSources] no jobId — runResp:', runResp.slice(0, 800));
      return [];
    }

    const rows = await pollAndDownload(token, networkCode, jobId);
    const resolvedPrefix = adUnitPrefix != null ? adUnitPrefix : _domainPrefix(domain);
    return _aggregateUtm(rows, 'utm_source', resolvedPrefix, rate);
  } catch (e) {
    console.warn('[GAM fetchUtmSources]', e.message);
    return [];
  }
}

// Shared aggregation helper for utm_campaign / utm_source.
// prefix: already resolved (string like 'mku_' or null for no filter)
function _aggregateUtm(rows, utmKey, prefix, rate) {
  const map = {};

  for (const row of rows) {
    const adUnit = row['Dimension.AD_UNIT_NAME'] || row['AD_UNIT_NAME'] || '';
    if (prefix && !adUnit.toLowerCase().startsWith(prefix)) continue;

    const kv = row['Dimension.CUSTOM_CRITERIA'] || row['CUSTOM_CRITERIA'] || '';
    const utm = _extractUTMValue(kv, utmKey);
    if (!utm || utm.toLowerCase() === 'null') continue;

    const imp = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
    const revMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
    const receita = (revMicros / 1_000_000) * rate;
    const ecpmMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || 0);
    const ctrRaw = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || 0);
    const cliques = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || 0);
    const cpcMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_CPC'] || 0);

    if (!map[utm]) map[utm] = { utm_campaign: utm, impressoes: 0, receita: 0, cliques: 0, ecpmWtSum: 0, ecpmWt: 0, ctrWtSum: 0, ctrWt: 0, cpcWtSum: 0, cpcWt: 0 };
    const m = map[utm];
    m.impressoes += imp;
    m.receita += receita;
    m.cliques += cliques;
    if (imp > 0 && ecpmMicros > 0) { m.ecpmWtSum += (ecpmMicros / 1_000_000) * rate * imp; m.ecpmWt += imp; }
    if (imp > 0) { m.ctrWtSum += ctrRaw * imp; m.ctrWt += imp; }
    if (cliques > 0 && cpcMicros > 0) { m.cpcWtSum += (cpcMicros / 1_000_000) * rate * cliques; m.cpcWt += cliques; }
  }

  return Object.values(map)
    .map(m => ({
      utm_campaign: m.utm_campaign,
      impressoes: m.impressoes,
      receita: +m.receita.toFixed(2),
      ecpm: m.ecpmWt > 0 ? +(m.ecpmWtSum / m.ecpmWt).toFixed(4) : 0,
      ctr: m.ctrWt > 0 ? +(m.ctrWtSum / m.ctrWt * 100).toFixed(4) : 0,
      cliques: m.cliques,
      cpc: m.cpcWt > 0 ? +(m.cpcWtSum / m.cpcWt).toFixed(4) : 0,
    }))
    .sort((a, b) => b.receita - a.receita);
}

function _domainPrefix(domain) {
  if (!domain || domain === 'all') return null;
  // mku → 'mku_', eur → 'eur_', etc.
  return domain.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 3) + '_';
}

// ─── fetchGAMBlocosFunil ─────────────────────────────────────────────────────
// Returns funnel blocks aggregated from utm_medium key-value in GAM CUSTOM_CRITERIA.
// Each utm_medium value is expected to be "blocX-botaoY-{utm}" — the utm suffix is stripped.
async function fetchGAMBlocosFunil({ since, until, utm } = {}) {
  const networkCode = NETWORK_CODE;
  if (!networkCode) return [];
  const dates = { since: since || defaultDateRange().since, until: until || defaultDateRange().until };

  try {
    const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);

    const xml = wrapEnvelope(soapHeader(networkCode), `
      <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
        <reportJob>
          <reportQuery>
            <dimensions>CUSTOM_CRITERIA</dimensions>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
            <startDate>${dateToXML(dates.since)}</startDate>
            <endDate>${dateToXML(dates.until)}</endDate>
            <dateRangeType>CUSTOM_DATE</dateRangeType>
          </reportQuery>
        </reportJob>
      </runReportJob>`);

    const runResp = await soapCall(token, xml);
    const jobId = extractTag(runResp, 'id');
    if (!jobId) {
      console.warn('[GAM blocosFunil] no jobId — runResp:', runResp.slice(0, 400));
      return [];
    }

    const rows = await pollAndDownload(token, networkCode, jobId);
    console.log(`[GAM blocosFunil] ${rows.length} linhas brutas, utm="${utm || 'all'}"`);

    const utmLower = utm ? utm.toLowerCase() : null;
    const suffix = utmLower ? `-${utmLower}` : null;
    const map = {};

    for (const row of rows) {
      const kv = row['Dimension.CUSTOM_CRITERIA'] || row['CUSTOM_CRITERIA'] || '';
      const medium = _extractUTMValue(kv, 'utm_medium');
      if (!medium || medium.toLowerCase() === 'null') continue;

      const mediumLower = medium.toLowerCase();

      // If utm specified: only keep rows whose utm_medium ends with "-utm"
      if (suffix && !mediumLower.endsWith(suffix)) continue;

      // Strip the "-utm" suffix to get the bloco-botao name
      const blocoBotao = suffix
        ? mediumLower.slice(0, -suffix.length)
        : mediumLower;

      if (!blocoBotao) continue;

      const imp = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
      const revMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
      const receita = (revMicros / 1_000_000) * rate;
      const ecpmMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || 0);
      const ctrRaw = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || 0);
      const cliques = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || 0);

      if (!map[blocoBotao]) map[blocoBotao] = { bloco_botao: blocoBotao, impressoes: 0, cliques: 0, receita: 0, ecpmWtSum: 0, ecpmWt: 0, ctrWtSum: 0, ctrWt: 0 };
      const m = map[blocoBotao];
      m.impressoes += imp;
      m.cliques += cliques;
      m.receita += receita;
      if (imp > 0 && ecpmMicros > 0) { m.ecpmWtSum += (ecpmMicros / 1_000_000) * rate * imp; m.ecpmWt += imp; }
      if (imp > 0) { m.ctrWtSum += ctrRaw * imp; m.ctrWt += imp; }
    }

    const result = Object.values(map).map(m => ({
      bloco_botao: m.bloco_botao,
      impressoes: m.impressoes,
      cliques: m.cliques,
      receita: +m.receita.toFixed(2),
      ecpm: m.ecpmWt > 0 ? +(m.ecpmWtSum / m.ecpmWt).toFixed(4) : 0,
      ctr: m.ctrWt > 0 ? +(m.ctrWtSum / m.ctrWt * 100).toFixed(4) : 0,
      rps: m.cliques > 0 ? +(m.receita / m.cliques).toFixed(4) : 0,
    })).sort((a, b) => b.receita - a.receita);

    console.log(`[GAM blocosFunil] ${result.length} blocos após filtro utm="${utmLower||'all'}"`);
    return result;
  } catch (e) {
    console.warn('[GAM fetchBlocosFunil]', e.message);
    return [];
  }
}

// ─── fetchGAMBotoesIndependente ──────────────────────────────────────────────
// Parses utm_medium with pattern: origem_pagina_botao[_label] (e.g. site_p1_bt1_tinder)
// Independent of utm_campaign — groups all utm_medium values from the period.
async function fetchGAMBotoesIndependente({ since, until, filtroOrigem, filtroPagina } = {}) {
  const networkCode = NETWORK_CODE;
  if (!networkCode) return { botoes: [], total_botoes: 0, totals: { impressoes: 0, cliques: 0, receita: 0 }, origens_disponiveis: [], paginas_disponiveis: [] };
  const dates = { since: since || defaultDateRange().since, until: until || defaultDateRange().until };

  function parseUtmMedium(utmMedium) {
    const partes = utmMedium.split('_');
    if (partes.length < 3) return { raw: utmMedium, origem: 'outros', pagina: null, botao: null, label: null, pagina_botao: utmMedium, bateu_padrao: false };
    const origem = partes[0];
    const pagina = partes[1];
    const botao  = partes[2];
    const label  = partes.length > 3 ? partes.slice(3).join('_') : null;
    const bateu_padrao = /^p\d+$/i.test(pagina) && /^bt\d+$/i.test(botao);
    return { raw: utmMedium, origem, pagina, botao, label, pagina_botao: `${pagina}_${botao}`, bateu_padrao };
  }

  try {
    const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);

    const xml = wrapEnvelope(soapHeader(networkCode), `
      <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
        <reportJob>
          <reportQuery>
            <dimensions>CUSTOM_CRITERIA</dimensions>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CTR</columns>
            <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS</columns>
            <startDate>${dateToXML(dates.since)}</startDate>
            <endDate>${dateToXML(dates.until)}</endDate>
            <dateRangeType>CUSTOM_DATE</dateRangeType>
          </reportQuery>
        </reportJob>
      </runReportJob>`);

    const runResp = await soapCall(token, xml);
    const jobId = extractTag(runResp, 'id');
    if (!jobId) { console.warn('[GAM botoes] no jobId'); return { botoes: [], total_botoes: 0, totals: { impressoes: 0, cliques: 0, receita: 0 }, origens_disponiveis: [], paginas_disponiveis: [] }; }

    const rows = await pollAndDownload(token, networkCode, jobId);
    console.log(`[GAM botoes] ${rows.length} linhas brutas`);

    const map = {};
    const origensSet = new Set();
    const paginasSet = new Set();

    for (const row of rows) {
      const kv = row['Dimension.CUSTOM_CRITERIA'] || row['CUSTOM_CRITERIA'] || '';
      const medium = _extractUTMValue(kv, 'utm_medium');
      if (!medium || medium.toLowerCase() === 'null') continue;

      const parsed = parseUtmMedium(medium.toLowerCase());

      if (parsed.origem !== 'site') continue;

      const key = parsed.pagina_botao;

      if (filtroOrigem && parsed.origem !== filtroOrigem) continue;
      if (filtroPagina && parsed.pagina !== filtroPagina) continue;

      origensSet.add(parsed.origem);
      if (parsed.pagina) paginasSet.add(parsed.pagina);

      const imp       = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
      const revMicros = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
      const receita   = (revMicros / 1_000_000) * rate;
      const ecpmMicros= Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM'] || 0);
      const ctrRaw    = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CTR'] || 0);
      const cliques   = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_CLICKS'] || 0);

      if (!map[key]) map[key] = { origem: parsed.origem, pagina: parsed.pagina, botao: parsed.botao, pagina_botao: key, impressoes: 0, cliques: 0, receita: 0, ecpmWtSum: 0, ecpmWt: 0, ctrWtSum: 0, ctrWt: 0, variantes_label: new Set() };
      const m = map[key];
      m.impressoes += imp;
      m.cliques    += cliques;
      m.receita    += receita;
      if (imp > 0 && ecpmMicros > 0) { m.ecpmWtSum += (ecpmMicros / 1_000_000) * rate * imp; m.ecpmWt += imp; }
      if (imp > 0) { m.ctrWtSum += ctrRaw * imp; m.ctrWt += imp; }
      if (parsed.label) m.variantes_label.add(parsed.label);
    }

    const botoes = Object.values(map).map(m => ({
      origem: m.origem,
      pagina: m.pagina,
      botao: m.botao,
      pagina_botao: m.pagina_botao,
      impressoes: m.impressoes,
      cliques: m.cliques,
      receita: +m.receita.toFixed(2),
      ecpm: m.ecpmWt > 0 ? +(m.ecpmWtSum / m.ecpmWt).toFixed(4) : 0,
      ctr: m.ctrWt > 0 ? +(m.ctrWtSum / m.ctrWt * 100).toFixed(4) : 0,
      rps: m.cliques > 0 ? +(m.receita / m.cliques).toFixed(4) : 0,
      variantes_label: [...m.variantes_label],
    })).sort((a, b) => b.receita - a.receita);

    const totals = botoes.reduce((acc, b) => ({ impressoes: acc.impressoes + b.impressoes, cliques: acc.cliques + b.cliques, receita: acc.receita + b.receita }), { impressoes: 0, cliques: 0, receita: 0 });
    totals.receita = +totals.receita.toFixed(2);

    console.log(`[GAM botoes] ${botoes.length} botões após agrupamento`);
    return {
      botoes,
      total_botoes: botoes.length,
      totals,
      origens_disponiveis: [...origensSet].sort(),
      paginas_disponiveis: [...paginasSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    };
  } catch (e) {
    console.warn('[GAM fetchBotoesIndependente]', e.message);
    return { botoes: [], total_botoes: 0, totals: { impressoes: 0, cliques: 0, receita: 0 }, origens_disponiveis: [], paginas_disponiveis: [] };
  }
}

// Diagnóstico: lista ad units (blocos) de uma rede com receita/impressões no período.
// Serve pra (1) validar que a service account acessa a rede e (2) descobrir o nome
// exato do bloco FILHO ao configurar um domínio GAM-2 (gam_fonte=2, ad_unit_filho).
async function fetchGAMAdUnitsRaw({ networkCode, since, until } = {}) {
  const nc = networkCode || NETWORK_CODE;
  if (!nc) return [];
  const dates = { since: since || defaultDateRange().since, until: until || defaultDateRange().until };
  const [token, rate] = await Promise.all([getAccessToken(), getUSDtoBRL()]);
  const xml = wrapEnvelope(soapHeader(nc), `
    <runReportJob xmlns="https://www.google.com/apis/ads/publisher/${GAM_VERSION}">
      <reportJob>
        <reportQuery>
          <dimensions>AD_UNIT_NAME</dimensions>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
          <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
          <startDate>${dateToXML(dates.since)}</startDate>
          <endDate>${dateToXML(dates.until)}</endDate>
          <dateRangeType>CUSTOM_DATE</dateRangeType>
        </reportQuery>
      </reportJob>
    </runReportJob>`);
  const runResp = await soapCall(token, xml);
  const jobId = extractTag(runResp, 'id');
  if (!jobId) { console.warn('[GAM adUnits] sem jobId:', runResp.slice(0, 500)); return []; }
  const rows = await pollAndDownload(token, nc, jobId);
  const map = {};
  for (const row of rows) {
    const adUnit = row['Dimension.AD_UNIT_NAME'] || row['AD_UNIT_NAME'] || '(sem nome)';
    const imp = Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
    const rev = (Number(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0) / 1_000_000) * rate;
    if (!map[adUnit]) map[adUnit] = { ad_unit: adUnit, impressoes: 0, receita: 0 };
    map[adUnit].impressoes += imp; map[adUnit].receita += rev;
  }
  return Object.values(map).map(m => ({ ...m, receita: +m.receita.toFixed(2) })).sort((a, b) => b.receita - a.receita);
}

module.exports = { fetchGAMReport, fetchGAMAdvertisers, discoverGAMNetworks, fetchGAMFunnelsByUTM, fetchGAMHourly, fetchGAMHourlyByDomain, fetchGAMUtmCampaigns, fetchGAMUtmSources, fetchGAMBlocosFunil, fetchGAMBotoesIndependente, fetchGAMAdUnitsRaw, getUSDtoBRL, getUSDtoBRLByDate };
