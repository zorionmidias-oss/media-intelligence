require('dotenv').config({ path: '.env.local' });
const { google } = require('googleapis');
const axios = require('axios');

(async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON,
    scopes: ['https://www.googleapis.com/auth/admanager']
  });
  const client = await auth.getClient();
  const token = (await client.getAccessToken()).token;
  const nc = process.env.GOOGLE_ADM_NETWORK_CODE;

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const ystr = yesterday.toISOString().slice(0, 10);
  const tstr = today.toISOString().slice(0, 10);
  const [y1, m1, d1] = ystr.split('-');
  const [y2, m2, d2] = tstr.split('-');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
<soapenv:Header>
  <ns1:RequestHeader xmlns:ns1="https://www.google.com/apis/ads/publisher/v202505" soapenv:mustUnderstand="0">
    <ns1:networkCode>${nc}</ns1:networkCode>
    <ns1:applicationName>diagnose</ns1:applicationName>
  </ns1:RequestHeader>
</soapenv:Header>
<soapenv:Body>
  <runReportJob xmlns="https://www.google.com/apis/ads/publisher/v202505">
    <reportJob>
      <reportQuery>
        <dimensions>AD_UNIT_NAME</dimensions>
        <dimensions>CUSTOM_CRITERIA</dimensions>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE</columns>
        <columns>AD_EXCHANGE_LINE_ITEM_LEVEL_AVERAGE_ECPM</columns>
        <startDate><year>${y1}</year><month>${parseInt(m1)}</month><day>${parseInt(d1)}</day></startDate>
        <endDate><year>${y2}</year><month>${parseInt(m2)}</month><day>${parseInt(d2)}</day></endDate>
        <dateRangeType>CUSTOM_DATE</dateRangeType>
      </reportQuery>
    </reportJob>
  </runReportJob>
</soapenv:Body>
</soapenv:Envelope>`;

  try {
    const r = await axios.post(
      'https://ads.google.com/apis/ads/publisher/v202505/ReportService',
      xml,
      { headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '', Authorization: `Bearer ${token}` } }
    );
    console.log('SUCESSO:', r.data);
  } catch (e) {
    console.log('STATUS:', e.response?.status);
    console.log('CORPO COMPLETO DO ERRO:');
    console.log(e.response?.data || e.message);
  }
})();
