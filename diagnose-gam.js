require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const axios = require('axios')
const { google } = require('googleapis')

const GAM_VERSION = 'v202505'
const NS = `https://www.google.com/apis/ads/publisher/${GAM_VERSION}`
const KEY_FILE = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON
const TARGET_NETWORK = process.env.GOOGLE_ADM_NETWORK_CODE

function wrap(headerExtra, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <ns1:RequestHeader xmlns:ns1="${NS}" soapenv:mustUnderstand="0">
      ${headerExtra}
      <ns1:applicationName>media-intelligence-diag</ns1:applicationName>
    </ns1:RequestHeader>
  </soapenv:Header>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`
}

async function soap(token, service, xml) {
  const url = `https://ads.google.com/apis/ads/publisher/${GAM_VERSION}/${service}`
  try {
    const r = await axios.post(url, xml, {
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '',
        Authorization: `Bearer ${token}`,
      },
      timeout: 20000,
    })
    return { status: r.status, body: r.data }
  } catch (err) {
    return {
      status: err.response?.status || 0,
      body: err.response?.data || err.message,
    }
  }
}

async function main() {
  console.log('══════════════════════════════════════════════')
  console.log(' GAM DIAGNOSE')
  console.log('══════════════════════════════════════════════')

  // ── 1. Credenciais ──────────────────────────────
  console.log('\n[1] Credenciais')
  if (!KEY_FILE || !fs.existsSync(KEY_FILE)) {
    console.log('  ERRO: arquivo não encontrado:', KEY_FILE)
    process.exit(1)
  }
  const creds = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'))
  console.log('  Arquivo    :', KEY_FILE)
  console.log('  SA email   :', creds.client_email)
  console.log('  Project    :', creds.project_id)
  console.log('  Network alvo:', TARGET_NETWORK)

  // ── 2. Token OAuth ──────────────────────────────
  console.log('\n[2] Gerando token OAuth')
  let token
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/admanager'],
    })
    const client = await auth.getClient()
    const resp = await client.getAccessToken()
    token = resp.token
    console.log('  Token gerado:', token ? token.slice(0, 40) + '…' : 'VAZIO')
  } catch (err) {
    console.log('  ERRO ao gerar token:', err.message)
    process.exit(1)
  }

  // ── 3. getAllNetworks (sem networkCode no header) ─
  console.log('\n[3] SOAP getAllNetworks (sem networkCode)')
  const xml3 = wrap('', `<getAllNetworks xmlns="${NS}"/>`)
  const r3 = await soap(token, 'NetworkService', xml3)
  console.log('  HTTP status:', r3.status)
  console.log('  Resposta XML completa:')
  console.log(String(r3.body))

  // ── 4. getCurrentNetwork (com networkCode) ───────
  console.log('\n[4] SOAP getCurrentNetwork (networkCode=' + TARGET_NETWORK + ')')
  const xml4 = wrap(`<ns1:networkCode>${TARGET_NETWORK}</ns1:networkCode>`, `<getCurrentNetwork xmlns="${NS}"/>`)
  const r4 = await soap(token, 'NetworkService', xml4)
  console.log('  HTTP status:', r4.status)
  console.log('  Resposta XML completa:')
  console.log(String(r4.body))

  // ── 5. REST /v1/networks ─────────────────────────
  console.log('\n[5] REST GET /v1/networks')
  try {
    const r5 = await axios.get('https://admanager.googleapis.com/v1/networks', {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    })
    console.log('  HTTP status:', r5.status)
    console.log('  Resposta:', JSON.stringify(r5.data, null, 2))
  } catch (err) {
    console.log('  HTTP status:', err.response?.status)
    console.log('  Resposta:', JSON.stringify(err.response?.data || err.message, null, 2))
  }

  // ── 6. REST /v1/networks/<code> ──────────────────
  console.log(`\n[6] REST GET /v1/networks/${TARGET_NETWORK}`)
  try {
    const r6 = await axios.get(`https://admanager.googleapis.com/v1/networks/${TARGET_NETWORK}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    })
    console.log('  HTTP status:', r6.status)
    console.log('  Resposta:', JSON.stringify(r6.data, null, 2))
  } catch (err) {
    console.log('  HTTP status:', err.response?.status)
    console.log('  Resposta:', JSON.stringify(err.response?.data || err.message, null, 2))
  }

  // ── 7. Tentativa de relatório mínimo ─────────────
  console.log('\n[7] SOAP runReportJob mínimo (networkCode=' + TARGET_NETWORK + ')')
  const today = new Date()
  const since = new Date(today); since.setDate(today.getDate() - 3)
  const fd = d => `<year>${d.getFullYear()}</year><month>${d.getMonth()+1}</month><day>${d.getDate()}</day>`
  const xml7 = wrap(
    `<ns1:networkCode>${TARGET_NETWORK}</ns1:networkCode>`,
    `<runReportJob xmlns="${NS}">
      <reportJob>
        <reportQuery>
          <dimensions>DATE</dimensions>
          <columns>AD_SERVER_IMPRESSIONS</columns>
          <startDate>${fd(since)}</startDate>
          <endDate>${fd(today)}</endDate>
          <dateRangeType>CUSTOM_DATE</dateRangeType>
        </reportQuery>
      </reportJob>
    </runReportJob>`
  )
  const r7 = await soap(token, 'ReportService', xml7)
  console.log('  HTTP status:', r7.status)
  console.log('  Resposta XML completa:')
  console.log(String(r7.body))

  console.log('\n══════════════════════════════════════════════')
  console.log(' FIM DO DIAGNÓSTICO')
  console.log('══════════════════════════════════════════════\n')
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1) })
