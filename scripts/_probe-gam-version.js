'use strict';
// Descobre quais versões da API SOAP do GAM ainda estão ativas.
const { google } = require('googleapis');
const axios = require('axios');

const SCOPE = ['https://www.googleapis.com/auth/admanager'];
const NETWORK_CODE = process.env.GOOGLE_ADM_NETWORK_CODE;
const SA = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON_CONTENT;
const KEY_FILE = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON || './credentials/google-service-account.json';

const CANDIDATAS = ['v202505', 'v202508', 'v202511', 'v202602', 'v202605', 'v202608'];

async function token() {
  const auth = SA
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(SA), scopes: SCOPE })
    : new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: SCOPE });
  return (await (await auth.getClient()).getAccessToken()).token;
}

(async () => {
  const t = await token();
  console.log('network:', NETWORK_CODE, '\n');
  for (const v of CANDIDATAS) {
    const ns = `https://www.google.com/apis/ads/publisher/${v}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <ns1:RequestHeader xmlns:ns1="${ns}" soapenv:actor="http://schemas.xmlsoap.org/soap/actor/next" soapenv:mustUnderstand="0">
      <ns1:networkCode>${NETWORK_CODE}</ns1:networkCode>
      <ns1:applicationName>media-intelligence</ns1:applicationName>
    </ns1:RequestHeader>
  </soapenv:Header>
  <soapenv:Body><getReportJobStatus xmlns="${ns}"><reportJobId>1</reportJobId></getReportJobStatus></soapenv:Body>
</soapenv:Envelope>`;
    let body = '';
    try {
      const r = await axios.post(`https://ads.google.com/apis/ads/publisher/${v}/ReportService`, xml, {
        headers: { 'Content-Type': 'text/xml; charset=utf-8', Authorization: `Bearer ${t}` }, timeout: 30000,
      });
      body = String(r.data);
    } catch (e) { body = String(e.response?.data || e.message); }
    const fault = (body.match(/<faultstring>([\s\S]*?)<\/faultstring>/) || [])[1] || '';
    const morta = /ApiVersionError|was deprecated and is now disabled|NOT_FOUND.*version/i.test(fault);
    // Erro de "job inexistente" ou similar = versão VIVA
    console.log(`${v}  ${morta ? '❌ DESATIVADA' : '✅ ATIVA    '}  ${fault.slice(0, 130) || '(sem fault — resposta OK)'}`);
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
